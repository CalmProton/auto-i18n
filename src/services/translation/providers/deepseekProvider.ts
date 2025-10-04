import OpenAI from 'openai'
import type { ProviderConfig } from '../../../config/env'
import { TRANSLATION_SYSTEM_PROMPT, buildJsonTranslationPrompt, buildMarkdownTranslationPrompt, JSON_RESPONSE_DIRECTIVE, JSON_TRANSLATION_WRAPPER_DIRECTIVE, MARKDOWN_RESPONSE_DIRECTIVE } from '../prompts'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from '../types'
import { StaggeredRequestQueue } from '../requestQueue'
import type { Logger } from '../../../utils/logger'
import { baseLogger, cloneValue, jsonType, parseJsonResponse, previewText, stringifyJson, type TranslationRequestContext } from '../providerShared'

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export class DeepseekProvider implements TranslationProviderAdapter {
  public readonly name = 'deepseek' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: OpenAI
  private readonly log: Logger
  private readonly baseURL: string
  private readonly requestQueue: StaggeredRequestQueue<TranslationRequestContext, string>

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_DEEPSEEK_MODEL
    this.baseURL = config.baseUrl && config.baseUrl.trim().length > 0 ? config.baseUrl : DEFAULT_DEEPSEEK_BASE_URL
    this.client = new OpenAI({
      apiKey: config.apiKey
      // baseURL: this.baseURL
    })
    this.log = baseLogger.child({ provider: this.name, model: this.model, baseURL: this.baseURL })

    this.requestQueue = new StaggeredRequestQueue(
      (context: TranslationRequestContext) => this.processRequest(context),
      {
        staggerDelayMs: 2000,
        maxConcurrentRequests: 3,
        requestTimeoutMs: 120000
      }
    )
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: TRANSLATION_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: `${context.instruction}\n\n---\n${context.content}\n---\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
          }
        ],
        temperature: 0,
        max_tokens: 32768
      })
      return this.extractMessageText(response)
    }

    const example = this.buildExampleJson(context.data)
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `${TRANSLATION_SYSTEM_PROMPT}\nThis task requires json output.`
        },
        {
          role: 'user',
          content: `${context.instruction}\n\nInput JSON:\n${stringifyJson(context.data)}\n\nEXAMPLE JSON OUTPUT (structure must exactly match the input JSON):\n${example}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n${JSON_RESPONSE_DIRECTIVE}`
        }
      ],
      temperature: 0,
      max_tokens: 32768,
      response_format: {
        type: 'json_object'
      }
    })
    return this.extractMessageText(response)
  }

  private extractMessageText(response: OpenAI.Chat.Completions.ChatCompletion): string {
    const firstChoice = response.choices?.[0]
    const content = firstChoice?.message?.content
    const finishReason = firstChoice?.finish_reason

    if (finishReason === 'length') {
      this.log.error('Deepseek response was truncated due to token limit', {
        model: this.model,
        finishReason,
        usage: response.usage
      })
      throw new Error('Response truncated: Token limit exceeded. Consider breaking down the content into smaller pieces.')
    }

    if (finishReason !== 'stop') {
      this.log.error('Deepseek response finished unexpectedly', {
        model: this.model,
        finishReason,
        expectedFinishReason: 'stop'
      })
      throw new Error(`Unexpected finish reason: ${finishReason}`)
    }

    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      return (content as Array<any>)
        .map((part: any) => {
          if (typeof part === 'string') {
            return part
          }
          if (part && part.type === 'text' && typeof part.text === 'string') {
            return part.text
          }
          return ''
        })
        .join('')
    }

    throw new Error('Deepseek returned empty response')
  }

  private buildExampleJson(data: unknown): string {
    const example = {
      translation: cloneValue(data)
    }
    return stringifyJson(example)
  }
}
