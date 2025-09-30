import Anthropic from '@anthropic-ai/sdk'
import type { ProviderConfig } from '../../../config/env'
import { TRANSLATION_SYSTEM_PROMPT, buildJsonTranslationPrompt, buildMarkdownTranslationPrompt, JSON_RESPONSE_DIRECTIVE, MARKDOWN_RESPONSE_DIRECTIVE } from '../prompts'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from '../types'
import { StaggeredRequestQueue } from '../requestQueue'
import type { Logger } from '../../../utils/logger'
import { baseLogger, jsonType, parseJsonResponse, previewText, stringifyJson, type TranslationRequestContext } from '../providerShared'

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307'

export class AnthropicProvider implements TranslationProviderAdapter {
  public readonly name = 'anthropic' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: Anthropic
  private readonly log: Logger
  private readonly requestQueue: StaggeredRequestQueue<TranslationRequestContext, string>

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_ANTHROPIC_MODEL
    this.client = new Anthropic({
      apiKey: config.apiKey
    })
    this.log = baseLogger.child({ provider: this.name, model: this.model })

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
      const result = await this.requestQueue.enqueue({
        type: 'json',
        job,
        instruction: prompt,
        data: job.data,
        schema: null
      })

      this.log.info('Received JSON translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        responseLength: result.length,
        responsePreview: previewText(result, 300)
      })
      return parseJsonResponse(result)
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
      return await this.sendMessage(context.instruction, context.content, false)
    }
    return await this.sendMessage(context.instruction, stringifyJson(context.data), true)
  }

  private async sendMessage(instruction: string, content: string, expectJson: boolean): Promise<string> {
    try {
      this.log.debug('Dispatching Anthropic request', {
        model: this.model,
        expectJson,
        instructionPreview: previewText(instruction, 200)
      })
      const message = await this.client.messages.create({
        model: this.model,
        system: TRANSLATION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${instruction}\n\n${expectJson ? 'Input JSON:' : 'Content:'}\n${content}\n\n${expectJson ? JSON_RESPONSE_DIRECTIVE : MARKDOWN_RESPONSE_DIRECTIVE}`
          }
        ],
        max_tokens: 16384
      })

      if (message.stop_reason === 'max_tokens') {
        this.log.error('Anthropic response was truncated due to token limit', {
          model: this.model,
          stopReason: message.stop_reason,
          usage: message.usage
        })
        throw new Error('Response truncated: Token limit exceeded. Consider breaking down the content into smaller pieces.')
      }

      if (message.stop_reason !== 'end_turn') {
        this.log.error('Anthropic response stopped unexpectedly', {
          model: this.model,
          stopReason: message.stop_reason,
          expectedStopReason: 'end_turn'
        })
        throw new Error(`Unexpected stop reason: ${message.stop_reason}`)
      }

      const text = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Anthropic')
      }
      return text
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        this.log.error('Anthropic request failed', {
          status: error.status,
          message: error.message,
          error
        })
        throw new Error(`Anthropic request failed (${error.status}): ${error.message}`)
      }
      this.log.error('Unexpected failure during Anthropic request', { error })
      throw error
    }
  }
}
