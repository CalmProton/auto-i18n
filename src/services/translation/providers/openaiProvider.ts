import OpenAI from 'openai'
import type { ZodTypeAny } from 'zod'
import type { ProviderConfig } from '../../../config/env'
import { TRANSLATION_SYSTEM_PROMPT, buildJsonTranslationPrompt, buildMarkdownTranslationPrompt, JSON_RESPONSE_DIRECTIVE, JSON_TRANSLATION_WRAPPER_DIRECTIVE, MARKDOWN_RESPONSE_DIRECTIVE } from '../prompts'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from '../types'
import { StaggeredRequestQueue } from '../requestQueue'
import { logApiResponse, getApiLogFile } from '../../../utils/apiResponseLogger'
import type { Logger } from '../../../utils/logger'
import { baseLogger, cloneValue, jsonType, parseJsonResponse, previewText, stringifyJson, type JsonRequestContext, type MarkdownRequestContext, type TranslationRequestContext } from '../providerShared'

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'

export class OpenAIProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: OpenAI
  private readonly log: Logger
  private readonly requestQueue: StaggeredRequestQueue<TranslationRequestContext, string>

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_OPENAI_MODEL
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {})
    })
    this.log = baseLogger.child({ provider: this.name, model: this.model })

    this.requestQueue = new StaggeredRequestQueue(
      (context: TranslationRequestContext) => this.processRequest(context),
      {
        staggerDelayMs: 3000,
        maxConcurrentRequests: 5,
        requestTimeoutMs: 360000
      }
    )

    this.log.info('OpenAI provider initialized', {
      model: this.model,
      apiLogFile: getApiLogFile(),
      queueConfig: {
        staggerDelayMs: 3000,
        maxConcurrentRequests: 5
      }
    })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = buildMarkdownTranslationPrompt(job.sourceLocale, job.targetLocale)

    this.log.info('Enqueuing markdown translation request', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      filePath: job.filePath,
      contentLength: job.content.length,
      contentPreview: previewText(job.content, 300),
      queueStats: this.requestQueue.getStats()
    })

    try {
      const result = await this.requestQueue.enqueue({
        type: 'markdown',
        job,
        instruction: prompt,
        content: job.content
      })

      this.log.info('Received markdown translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        responseLength: result.length,
        responsePreview: previewText(result, 300)
      })

      return result.trim().length > 0 ? result : job.content
    } catch (error) {
      this.log.error('Markdown translation failed', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        error
      })
      throw error
    }
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    const prompt = buildJsonTranslationPrompt(job.sourceLocale, job.targetLocale)

    this.log.info('Enqueuing JSON translation request', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      filePath: job.filePath,
      dataType: jsonType(job.data),
      queueStats: this.requestQueue.getStats()
    })

    try {
      const response = await this.requestQueue.enqueue({
        type: 'json',
        job,
        instruction: prompt,
        data: job.data,
        schema: null
      })

      const parsed = parseJsonResponse(response) as { translation: unknown }

      if (jsonType(job.data) !== jsonType(parsed.translation)) {
        this.log.warn('JSON translation response type mismatch, returning original data', {
          senderId: job.senderId,
          sourceLocale: job.sourceLocale,
          targetLocale: job.targetLocale,
          filePath: job.filePath,
          expected: jsonType(job.data),
          received: jsonType(parsed.translation)
        })
        return cloneValue(job.data)
      }

      this.log.info('Received JSON translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath
      })
      return parsed.translation
    } catch (error) {
      this.log.error('JSON translation failed', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        error
      })
      throw error
    }
  }

  private async processRequest(context: TranslationRequestContext): Promise<string> {
    if (context.type === 'markdown') {
      return await this.sendMarkdownRequest(context.instruction, context.content, context)
    }
    return await this.sendJsonRequest(context.instruction, context.data, context.schema, context)
  }

  private async sendMarkdownRequest(instruction: string, content: string, context?: MarkdownRequestContext): Promise<string> {
    const requestPayload = {
      model: this.model,
      messages: [
        {
          role: 'system' as const,
          content: TRANSLATION_SYSTEM_PROMPT
        },
        {
          role: 'user' as const,
          content: `${instruction}\n\n---\n${content}\n---\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
        }
      ],
      temperature: 1,
      max_completion_tokens: 16384
    }

    try {
      this.log.debug('Dispatching markdown request to OpenAI', {
        model: this.model,
        instructionPreview: previewText(instruction, 200),
        contentLength: content.length
      })

      const response = await this.client.chat.completions.create(requestPayload)

      const finishReason = response.choices?.[0]?.finish_reason
      const isSuccess = finishReason === 'stop'
      const text = response.choices?.[0]?.message?.content

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'markdown',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: requestPayload,
        response: response,
        success: isSuccess
      })

      this.log.debug('OpenAI response received', {
        model: this.model,
        choices: response.choices?.length || 0,
        usage: response.usage,
        finishReason: finishReason,
        contentLength: text?.length || 0,
        isSuccess
      })

      if (finishReason === 'length') {
        this.log.error('OpenAI response was truncated due to token limit', {
          model: this.model,
          finishReason,
          usage: response.usage,
          maxTokens: requestPayload.max_completion_tokens
        })
        throw new Error('Response truncated: Token limit exceeded. Consider breaking down the content into smaller pieces.')
      }

      if (finishReason !== 'stop') {
        this.log.error('OpenAI response finished unexpectedly', {
          model: this.model,
          finishReason,
          expectedFinishReason: 'stop'
        })
        throw new Error(`Unexpected finish reason: ${finishReason}`)
      }

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        this.log.error('OpenAI returned empty markdown content', {
          model: this.model,
          responseChoices: response.choices,
          responseStructure: {
            hasChoices: !!response.choices,
            choicesLength: response.choices?.length,
            firstChoiceMessage: response.choices?.[0]?.message,
            fullResponse: JSON.stringify(response, null, 2)
          }
        })
        throw new Error('Empty response from OpenAI')
      }
      return text
    } catch (error) {
      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'markdown',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: requestPayload,
        response: null,
        error: error,
        success: false
      })

      if (error instanceof OpenAI.APIError) {
        this.log.error('OpenAI markdown request failed', {
          status: error.status,
          message: error.message,
          type: error.type,
          code: error.code,
          error
        })
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
      this.log.error('Unexpected failure during OpenAI markdown request', { error })
      throw error
    }
  }

  private async sendJsonRequest(instruction: string, data: unknown, _schema: ZodTypeAny | null, context?: JsonRequestContext): Promise<string> {
    const requestPayload = {
      model: this.model,
      messages: [
        {
          role: 'system' as const,
          content: TRANSLATION_SYSTEM_PROMPT
        },
        {
          role: 'user' as const,
          content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n${JSON_RESPONSE_DIRECTIVE}`
        }
      ],
      temperature: 1,
      max_completion_tokens: 16384,
      response_format: {
        type: 'json_object' as const
      }
    }

    try {
      this.log.debug('Dispatching JSON request to OpenAI', {
        model: this.model,
        instructionPreview: previewText(instruction, 200),
        dataType: jsonType(data)
      })

      const response = await this.client.chat.completions.create(requestPayload)

      const finishReason = response.choices?.[0]?.finish_reason
      const isSuccess = finishReason === 'stop'
      const text = response.choices?.[0]?.message?.content

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'json',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: requestPayload,
        response: response,
        success: isSuccess
      })

      this.log.debug('OpenAI JSON response received', {
        model: this.model,
        choices: response.choices?.length || 0,
        usage: response.usage,
        finishReason: finishReason,
        contentLength: text?.length || 0,
        isSuccess
      })

      if (finishReason === 'length') {
        this.log.error('OpenAI JSON response was truncated due to token limit', {
          model: this.model,
          finishReason,
          usage: response.usage,
          maxTokens: requestPayload.max_completion_tokens
        })
        throw new Error('JSON response truncated: Token limit exceeded. Consider breaking down the content into smaller pieces.')
      }

      if (finishReason !== 'stop') {
        this.log.error('OpenAI JSON response finished unexpectedly', {
          model: this.model,
          finishReason,
          expectedFinishReason: 'stop'
        })
        throw new Error(`Unexpected finish reason: ${finishReason}`)
      }

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        this.log.error('OpenAI returned empty JSON content', {
          model: this.model,
          responseChoices: response.choices,
          responseStructure: {
            hasChoices: !!response.choices,
            choicesLength: response.choices?.length,
            firstChoiceMessage: response.choices?.[0]?.message,
            fullResponse: JSON.stringify(response, null, 2)
          }
        })
        throw new Error('Empty JSON response from OpenAI')
      }
      return text
    } catch (error) {
      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'json',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: requestPayload,
        response: null,
        error: error,
        success: false
      })

      if (error instanceof OpenAI.APIError) {
        this.log.error('OpenAI JSON request failed', {
          status: error.status,
          message: error.message,
          type: error.type,
          code: error.code,
          error
        })
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
      this.log.error('Unexpected failure during OpenAI JSON request', { error })
      throw error
    }
  }
}
