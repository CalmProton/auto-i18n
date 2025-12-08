/**
 * OpenRouter Translation Provider
 * Uses OpenRouter's OpenAI-compatible API to access multiple AI models
 */
import OpenAI from 'openai'
import type { ProviderConfig } from '../../../config/env'
import { TRANSLATION_SYSTEM_PROMPT, buildJsonTranslationPrompt, buildMarkdownTranslationPrompt, JSON_RESPONSE_DIRECTIVE, JSON_TRANSLATION_WRAPPER_DIRECTIVE, MARKDOWN_RESPONSE_DIRECTIVE } from '../prompts'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from '../types'
import { StaggeredRequestQueue } from '../requestQueue'
import { logApiResponse, getApiLogFile } from '../../../utils/apiResponseLogger'
import type { Logger } from '../../../utils/logger'
import { baseLogger, cloneValue, jsonType, parseJsonResponse, previewText, stringifyJson, type JsonRequestContext, type MarkdownRequestContext, type TranslationRequestContext } from '../providerShared'

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini'

export function resolveOpenRouterModel(config: ProviderConfig): string {
  const configured = config.model?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_OPENROUTER_MODEL
}

export class OpenRouterProvider implements TranslationProviderAdapter {
  public readonly name = 'openrouter' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: OpenAI
  private readonly log: Logger
  private readonly requestQueue: StaggeredRequestQueue<TranslationRequestContext, string>

  constructor(private readonly config: ProviderConfig) {
    this.model = resolveOpenRouterModel(config)
    
    // OpenRouter uses OpenAI-compatible API
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/auto-i18n',
        'X-Title': 'Auto-i18n Translation Service',
      },
    })
    
    this.log = baseLogger.child({ provider: this.name, model: this.model })

    this.requestQueue = new StaggeredRequestQueue(
      (context: TranslationRequestContext) => this.processRequest(context),
      {
        staggerDelayMs: 2000, // OpenRouter has generous rate limits
        maxConcurrentRequests: 10,
        requestTimeoutMs: 360000
      }
    )

    this.log.info('OpenRouter provider initialized', {
      model: this.model,
      apiLogFile: getApiLogFile(),
      queueConfig: {
        staggerDelayMs: 2000,
        maxConcurrentRequests: 10
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
    const messages = [
      {
        role: 'system' as const,
        content: `${TRANSLATION_SYSTEM_PROMPT}\n\n${instruction}\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
      },
      {
        role: 'user' as const,
        content: `---\n${content}\n---`
      }
    ]

    try {
      this.log.debug('Dispatching markdown request to OpenRouter', {
        model: this.model,
        instructionPreview: previewText(instruction, 200),
        contentLength: content.length
      })

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 32768,
      })

      const choice = response.choices[0]
      const finishReason = choice?.finish_reason
      const isSuccess = finishReason === 'stop'
      const text = choice?.message?.content || ''

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'markdown',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: { model: this.model, messages },
        response: response,
        success: isSuccess
      })

      this.log.debug('OpenRouter response received', {
        model: this.model,
        usage: response.usage,
        finishReason,
        contentLength: text?.length || 0,
        isSuccess
      })

      if (!isSuccess) {
        this.log.warn('OpenRouter request did not complete successfully', {
          finishReason,
          model: this.model
        })
      }

      return text
    } catch (error) {
      this.log.error('OpenRouter markdown request failed', {
        model: this.model,
        error
      })

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'markdown',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: { model: this.model, messages },
        response: null,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })

      throw error
    }
  }

  private async sendJsonRequest(
    instruction: string,
    data: unknown,
    schema: unknown,
    context?: JsonRequestContext
  ): Promise<string> {
    const userContent = `${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n\n\`\`\`json\n${stringifyJson(data)}\n\`\`\``

    const messages = [
      {
        role: 'system' as const,
        content: `${TRANSLATION_SYSTEM_PROMPT}\n\n${instruction}\n\n${JSON_RESPONSE_DIRECTIVE}`
      },
      {
        role: 'user' as const,
        content: userContent
      }
    ]

    try {
      this.log.debug('Dispatching JSON request to OpenRouter', {
        model: this.model,
        instructionPreview: previewText(instruction, 200),
        dataType: jsonType(data)
      })

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 32768,
        response_format: { type: 'json_object' },
      })

      const choice = response.choices[0]
      const finishReason = choice?.finish_reason
      const isSuccess = finishReason === 'stop'
      const text = choice?.message?.content || ''

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'json',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: { model: this.model, messages },
        response: response,
        success: isSuccess
      })

      this.log.debug('OpenRouter JSON response received', {
        model: this.model,
        usage: response.usage,
        finishReason,
        contentLength: text?.length || 0,
        isSuccess
      })

      if (!isSuccess) {
        this.log.warn('OpenRouter JSON request did not complete successfully', {
          finishReason,
          model: this.model
        })
      }

      return text
    } catch (error) {
      this.log.error('OpenRouter JSON request failed', {
        model: this.model,
        error
      })

      await logApiResponse({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        requestType: 'json',
        senderId: context?.job.senderId || 'unknown',
        sourceLocale: context?.job.sourceLocale || 'unknown',
        targetLocale: context?.job.targetLocale || 'unknown',
        filePath: context?.job.filePath || 'unknown',
        request: { model: this.model, messages },
        response: null,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })

      throw error
    }
  }
}
