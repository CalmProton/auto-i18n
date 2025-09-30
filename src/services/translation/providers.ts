import { getTranslationConfig } from '../../config/env'
import { getApiLogFile } from '../../utils/apiResponseLogger'
import { baseLogger, cloneValue, jsonType } from './providerShared'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from './types'
import { OpenAIProvider } from './providers/openaiProvider'
import { DeepseekProvider } from './providers/deepseekProvider'
import { AnthropicProvider } from './providers/anthropicProvider'

class NoOpTranslationProvider implements TranslationProviderAdapter {
  public readonly name = 'openai' as const
  public readonly isFallback = true

  private readonly log = baseLogger.child({ provider: 'noop' })

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
    const apiLogFile = getApiLogFile()

    baseLogger.info('Initializing translation provider', {
      provider: config.provider,
      apiResponseLogFile: apiLogFile,
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
    if (config.provider === 'deepseek') {
      return new DeepseekProvider(config.providerConfig)
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
