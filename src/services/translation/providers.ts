import { z, type ZodTypeAny } from 'zod'
import { zodTextFormat } from 'openai/helpers/zod'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { getTranslationConfig, type ProviderConfig } from '../../config/env'
import { SUPPORTED_LOCALES } from '../../config/locales'
import type {
  TranslationProviderAdapter,
  MarkdownTranslationInput,
  JsonTranslationInput
} from './types'

const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-08-06'
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307'

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

function localeName(code: string): string {
  return SUPPORTED_LOCALES.find((item) => item.code === code)?.name ?? code
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

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_OPENAI_MODEL
    this.client = new OpenAI({
      apiKey: config.apiKey
    })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = `Translate the following Markdown content from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Preserve the original Markdown structure, code fences, front matter, and placeholders. Only return the translated Markdown without commentary.'

    try {
      const text = await this.sendMarkdownRequest(prompt, job.content)
      return text.trim().length > 0 ? text : job.content
    } catch (error) {
      console.error(`[translation] ${this.name} markdown translation failed:`, error)
      throw error
    }
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    const prompt = `Translate the JSON values from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Do not change the keys or structure. Only return valid JSON with translated string values. Leave non-string values untouched.'

    try {
      console.log('[translation] Data type:', jsonType(job.data))
      
      const response = await this.sendJsonRequest(prompt, job.data, null)
      const parsed = parseJsonResponse(response) as { translation: unknown }
      
      // Validate the response has the same structure as input
      if (jsonType(job.data) !== jsonType(parsed.translation)) {
        console.warn('[translation] Response type mismatch, returning original data')
        return cloneValue(job.data)
      }
      
      return parsed.translation
    } catch (error) {
      console.error(`[translation] ${this.name} json translation failed:`, error)
      throw error
    }
  }

  private async sendMarkdownRequest(instruction: string, content: string): Promise<string> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content: 'You are a professional localization specialist.'
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
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
      throw error
    }
  }

  private async sendJsonRequest(instruction: string, data: unknown, schema: ZodTypeAny | null): Promise<string> {
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
      
      console.log('[translation] Manual JSON schema:', JSON.stringify(jsonSchema, null, 2))
      
      const response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content: 'You are a professional localization specialist.'
          },
          {
            role: 'user',
            content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\nPlease return the translated JSON wrapped in an object with a "translation" key like this: {"translation": <your_translated_json>}`
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
        throw new Error(`OpenAI request failed (${error.status}): ${error.message}`)
      }
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

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_ANTHROPIC_MODEL
    this.client = new Anthropic({
      apiKey: config.apiKey
    })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = `Translate the following Markdown content from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Preserve the original Markdown structure, code fences, front matter, and placeholders. Only return the translated Markdown without commentary.'

    try {
      const text = await this.sendMessage(prompt, job.content, false)
      return text.trim().length > 0 ? text : job.content
    } catch (error) {
      console.error(`[translation] ${this.name} markdown translation failed:`, error)
      throw error
    }
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    const prompt = `Translate the JSON values from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Do not change the keys or structure. Only return valid JSON with translated string values. Leave non-string values untouched.'

    try {
      const text = await this.sendMessage(prompt, stringifyJson(job.data), true)
      return parseJsonResponse(text)
    } catch (error) {
      console.error(`[translation] ${this.name} json translation failed:`, error)
      throw error
    }
  }

  private async sendMessage(instruction: string, content: string, expectJson: boolean): Promise<string> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        system: 'You are a professional localization specialist.',
        messages: [
          {
            role: 'user',
            content: `${instruction}\n\n${expectJson ? 'Input JSON:' : 'Content:'}\n${content}\n\n${expectJson ? 'Return only the translated JSON.' : 'Return only the translated Markdown.'}`
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
        throw new Error(`Anthropic request failed (${error.status}): ${error.message}`)
      }
      throw error
    }
  }
}

class NoOpTranslationProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = true

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    console.warn('[translation] No provider configured. Returning original markdown content.')
    return job.content
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    console.warn('[translation] No provider configured. Returning original json content.')
    return cloneValue(job.data)
  }
}



let cachedProvider: TranslationProviderAdapter | null = null

function createProvider(): TranslationProviderAdapter {
  try {
    const config = getTranslationConfig()
    if (config.provider === 'openai') {
      return new OpenAIProvider(config.providerConfig)
    }
    if (config.provider === 'anthropic') {
      return new AnthropicProvider(config.providerConfig)
    }
    return new NoOpTranslationProvider()
  } catch (error) {
    console.warn('[translation] Falling back to no-op provider:', error)
    return new NoOpTranslationProvider()
  }
}

export function getTranslationProvider(): TranslationProviderAdapter {
  if (!cachedProvider) {
    cachedProvider = createProvider()
  }
  return cachedProvider
}
