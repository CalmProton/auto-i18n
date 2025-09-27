import { getTranslationConfig, type ProviderConfig } from '../../config/env'
import { SUPPORTED_LOCALES } from '../../config/locales'
import type {
  TranslationProviderAdapter,
  MarkdownTranslationInput,
  JsonTranslationInput
} from './types'

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
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

function fallbackText(original: string, providerName: string, reason: unknown): string {
  console.warn(`[translation] ${providerName} markdown translation failed, falling back to original text.`, reason)
  return original
}

function fallbackJson(original: unknown, providerName: string, reason: unknown): unknown {
  console.warn(`[translation] ${providerName} json translation failed, falling back to source data.`, reason)
  return cloneValue(original)
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

class OpenAIProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = false

  private readonly model: string

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_OPENAI_MODEL
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = `Translate the following Markdown content from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Preserve the original Markdown structure, code fences, front matter, and placeholders. Only return the translated Markdown without commentary.'

    try {
      const text = await this.sendMarkdownRequest(prompt, job.content)
      return text.trim().length > 0 ? text : job.content
    } catch (error) {
      return fallbackText(job.content, this.name, error)
    }
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    const prompt = `Translate the JSON values from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Do not change the keys or structure. Only return valid JSON with translated string values. Leave non-string values untouched.'

    try {
      const response = await this.sendJsonRequest(prompt, job.data)
      return parseJsonResponse(response)
    } catch (error) {
      return fallbackJson(job.data, this.name, error)
    }
  }

  private async sendMarkdownRequest(instruction: string, content: string): Promise<string> {
    const payload = {
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
    }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`OpenAI request failed (${response.status} ${response.statusText}): ${message}`)
    }

    const data = await response.json()
    const text = extractOpenAIText(data)
    if (!text) {
      throw new Error('Empty response from OpenAI')
    }
    return text
  }

  private async sendJsonRequest(instruction: string, data: unknown): Promise<string> {
    const payload = {
  model: this.model,
      input: [
        {
          role: 'system',
          content: 'You are a professional localization specialist.'
        },
        {
          role: 'user',
          content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\nReturn only the translated JSON.`
        }
      ],
      response_format: { type: 'json_object' }
    }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`OpenAI request failed (${response.status} ${response.statusText}): ${message}`)
    }

    const dataResponse = await response.json()
    const text = extractOpenAIText(dataResponse)
    if (!text) {
      throw new Error('Empty JSON response from OpenAI')
    }
    return text
  }
}

class AnthropicProvider implements TranslationProviderAdapter {
  public readonly name = 'anthropic' as const
  public readonly isFallback = false

  private readonly model: string

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model && config.model.trim().length > 0 ? config.model : DEFAULT_ANTHROPIC_MODEL
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    const prompt = `Translate the following Markdown content from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Preserve the original Markdown structure, code fences, front matter, and placeholders. Only return the translated Markdown without commentary.'

    try {
      const text = await this.sendMessage(prompt, job.content, false)
      return text.trim().length > 0 ? text : job.content
    } catch (error) {
      return fallbackText(job.content, this.name, error)
    }
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    const prompt = `Translate the JSON values from ${localeName(job.sourceLocale)} (${job.sourceLocale}) to ${localeName(job.targetLocale)} (${job.targetLocale}). ` +
      'Do not change the keys or structure. Only return valid JSON with translated string values. Leave non-string values untouched.'

    try {
      const text = await this.sendMessage(prompt, stringifyJson(job.data), true)
      return parseJsonResponse(text)
    } catch (error) {
      return fallbackJson(job.data, this.name, error)
    }
  }

  private async sendMessage(instruction: string, content: string, expectJson: boolean): Promise<string> {
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
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
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Anthropic request failed (${response.status} ${response.statusText}): ${message}`)
    }

    const data = await response.json()
    const text = extractAnthropicText(data)
    if (!text) {
      throw new Error('Empty response from Anthropic')
    }
    return text
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

function extractOpenAIText(responseData: any): string | null {
  if (!responseData) {
    return null
  }

  if (Array.isArray(responseData.output_text) && responseData.output_text.length > 0) {
    return responseData.output_text.join('').trim()
  }

  if (Array.isArray(responseData.output) && responseData.output.length > 0) {
    const buffer = responseData.output
      .map((item: any) => (item?.content ?? item?.text ?? ''))
      .filter((value: string) => typeof value === 'string' && value.trim().length > 0)
    if (buffer.length > 0) {
      return buffer.join('\n').trim()
    }
  }

  if (Array.isArray(responseData.content) && responseData.content.length > 0) {
    const buffer = responseData.content
      .map((item: any) => (item?.text ?? (Array.isArray(item?.content) ? item.content.map((inner: any) => inner?.text ?? '').join(' ') : '')))
      .filter((value: string) => typeof value === 'string' && value.trim().length > 0)
    if (buffer.length > 0) {
      return buffer.join('\n').trim()
    }
  }

  if (typeof responseData === 'string') {
    return responseData.trim()
  }

  return null
}

function extractAnthropicText(responseData: any): string | null {
  if (!responseData) {
    return null
  }

  if (Array.isArray(responseData.content)) {
    const buffer = responseData.content
      .map((item: any) => (item?.text ?? ''))
      .filter((value: string) => typeof value === 'string' && value.trim().length > 0)
    if (buffer.length > 0) {
      return buffer.join('\n').trim()
    }
  }

  if (typeof responseData?.completion === 'string') {
    return responseData.completion.trim()
  }

  if (typeof responseData === 'string') {
    return responseData.trim()
  }

  return null
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
