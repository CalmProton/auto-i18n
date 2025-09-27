import { z, type ZodTypeAny } from 'zod'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { getTranslationConfig, type ProviderConfig } from '../../config/env'
import { createScopedLogger, type Logger } from '../../utils/logger'
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildJsonTranslationPrompt,
  buildMarkdownTranslationPrompt,
  JSON_RESPONSE_DIRECTIVE,
  JSON_TRANSLATION_WRAPPER_DIRECTIVE,
  MARKDOWN_RESPONSE_DIRECTIVE
} from './prompts'
import type {
  TranslationProviderAdapter,
  MarkdownTranslationInput,
  JsonTranslationInput
} from './types'

const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-08-06'
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307'

const baseLogger = createScopedLogger('translation:provider')

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  if (value === undefined || value === null) {
    return value
  }
  const json = JSON.stringify(value)
  if (!json) {
    return value
  }
  return JSON.parse(json)
}

function stringifyJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function parseJsonResponse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Provider returned invalid JSON: ${(error as Error).message}`)
  }
}

function jsonType(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

function previewText(value: string, maxLength = 200): string {
  if (value.length <= maxLength) {
    return value
  }
  const sliced = value.slice(0, maxLength)
  const omitted = value.length - maxLength
  return `${sliced}… [+${omitted} chars]`
}

function buildSchemaFromJson(value: unknown): ZodTypeAny {
  const kind = jsonType(value)

  switch (kind) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const arrayValue = value as unknown[]
      if (arrayValue.length === 0) {
        return z.array(z.string())
      }

      const firstKind = jsonType(arrayValue[0])
      const uniform = arrayValue.every((item) => jsonType(item) === firstKind)
      if (uniform) {
        return z.array(buildSchemaFromJson(arrayValue[0]))
      }

      // For mixed arrays, fallback to unknown for simplicity

      return z.array(z.unknown())
    }
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>)
      const shape: Record<string, ZodTypeAny> = {}

      for (const [key, entryValue] of entries) {
        shape[key] = buildSchemaFromJson(entryValue)
      }

      return z.object(shape).passthrough()
    }
    default:
      return z.unknown()
  }
}

class OpenAIProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: OpenAI
  private readonly log: Logger

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_OPENAI_MODEL
    this.client = new OpenAI({
      apiKey: config.apiKey
    })
    this.log = baseLogger.child({ provider: this.name, model: this.model })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = buildMarkdownTranslationPrompt(job.sourceLocale, job.targetLocale)

    try {
      this.log.info('Sending markdown translation request', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        contentLength: job.content.length,
        contentPreview: previewText(job.content, 300)
      })
      const text = await this.sendMarkdownRequest(prompt, job.content)
      this.log.info('Received markdown translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        responseLength: text.length,
        responsePreview: previewText(text, 300)
      })
      return text.trim().length > 0 ? text : job.content
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

    try {
      this.log.info('Sending JSON translation request', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        dataType: jsonType(job.data)
      })
      const response = await this.sendJsonRequest(prompt, job.data, null)
      const parsed = parseJsonResponse(response) as { translation: unknown }
      
      // Validate the response has the same structure as input
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

  private async sendMarkdownRequest(instruction: string, content: string): Promise<string> {
    try {
      this.log.debug('Dispatching markdown request to OpenAI', {
        model: this.model,
        instructionPreview: previewText(instruction, 200)
      })
      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content: TRANSLATION_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: `${instruction}\n\n---\n${content}\n---`
          }
        ]
      })

      const text = response.output_text
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Empty response from OpenAI')
      }
      return text
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        this.log.error('OpenAI markdown request failed', {
          status: error.status,
          message: error.message,
          error
        })
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
      this.log.error('Unexpected failure during OpenAI markdown request', { error })
      throw error
    }
  }

  private async sendJsonRequest(instruction: string, data: unknown, _schema: ZodTypeAny | null): Promise<string> {
    try {
      // Create a proper JSON Schema manually to ensure it's correct
      const jsonSchema = {
        type: "object" as const,
        properties: {
          translation: this.buildJsonSchemaFromData(data)
        },
        required: ["translation"],
        additionalProperties: false
      }
      
      this.log.debug('Dispatching JSON request to OpenAI', {
        model: this.model,
        instructionPreview: previewText(instruction, 200)
      })

      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content: TRANSLATION_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}`
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "translation",
            strict: true,
            schema: jsonSchema
          }
        }
      })

      const text = response.output_text
      
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Empty JSON response from OpenAI')
      }
      return text
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        this.log.error('OpenAI JSON request failed', {
          status: error.status,
          message: error.message,
          error
        })
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
      this.log.error('Unexpected failure during OpenAI JSON request', { error })
      throw error
    }
  }

  private buildJsonSchemaFromData(data: unknown): any {
    const kind = jsonType(data)
    
    switch (kind) {
      case 'string':
        return { type: "string" }
      case 'number':
        return { type: "number" }
      case 'boolean':
        return { type: "boolean" }
      case 'null':
        return { type: "null" }
      case 'array': {
        const arrayValue = data as unknown[]
        if (arrayValue.length === 0) {
          return { type: "array", items: { type: "string" } }
        }
        
        const firstItem = arrayValue[0]
        return { 
          type: "array", 
          items: this.buildJsonSchemaFromData(firstItem)
        }
      }
      case 'object': {
        const obj = data as Record<string, unknown>
        const properties: Record<string, any> = {}
        const required: string[] = []
        
        for (const [key, value] of Object.entries(obj)) {
          properties[key] = this.buildJsonSchemaFromData(value)
          required.push(key)
        }
        
        return {
          type: "object",
          properties,
          required,
          additionalProperties: false
        }
      }
      default:
        return { type: "string" }
    }
  }
}

class AnthropicProvider implements TranslationProviderAdapter {
  public readonly name = 'anthropic' as const
  public readonly isFallback = false

  private readonly model: string
  private readonly client: Anthropic
  private readonly log: Logger

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_ANTHROPIC_MODEL
    this.client = new Anthropic({
      apiKey: config.apiKey
    })
    this.log = baseLogger.child({ provider: this.name, model: this.model })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = buildMarkdownTranslationPrompt(job.sourceLocale, job.targetLocale)

    try {
      this.log.info('Sending markdown translation request', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        contentLength: job.content.length,
        contentPreview: previewText(job.content, 300)
      })
      const text = await this.sendMessage(prompt, job.content, false)
      this.log.info('Received markdown translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        responseLength: text.length,
        responsePreview: previewText(text, 300)
      })
      return text.trim().length > 0 ? text : job.content
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

    try {
      this.log.info('Sending JSON translation request', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        dataType: jsonType(job.data)
      })
      const text = await this.sendMessage(prompt, stringifyJson(job.data), true)
      this.log.info('Received JSON translation response', {
        senderId: job.senderId,
        sourceLocale: job.sourceLocale,
        targetLocale: job.targetLocale,
        filePath: job.filePath,
        responseLength: text.length,
        responsePreview: previewText(text, 300)
      })
      return parseJsonResponse(text)
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
        max_tokens: 4096
      })

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

class NoOpTranslationProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = true

  private readonly log: Logger = baseLogger.child({ provider: 'noop' })

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    this.log.warn('No provider configured. Returning original markdown content.', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      filePath: job.filePath
    })
    return job.content
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    this.log.warn('No provider configured. Returning original JSON content.', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      filePath: job.filePath,
      dataType: jsonType(job.data)
    })
    return cloneValue(job.data)
  }
}



let cachedProvider: TranslationProviderAdapter | null = null

function createProvider(): TranslationProviderAdapter {
  try {
    const config = getTranslationConfig()
    baseLogger.info('Initializing translation provider', {
      provider: config.provider,
      availableProviders: Object.entries(config.providers).map(([name, providerConfig]) => ({
        name,
        hasApiKey: Boolean(providerConfig?.apiKey)
      }))
    })
    if (config.provider === 'openai') {
      return new OpenAIProvider(config.providerConfig)
    }
    if (config.provider === 'anthropic') {
      return new AnthropicProvider(config.providerConfig)
    }
    return new NoOpTranslationProvider()
  } catch (error) {
    baseLogger.warn('Falling back to no-op translation provider', { error })
    return new NoOpTranslationProvider()
  }
}

export function getTranslationProvider(): TranslationProviderAdapter {
  if (!cachedProvider) {
    cachedProvider = createProvider()
  }
  return cachedProvider
}
