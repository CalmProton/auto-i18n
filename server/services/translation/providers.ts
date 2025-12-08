import { getTranslationConfig, isMockModeEnabled } from '../../config/env'
import { getApiLogFile } from '../../utils/apiResponseLogger'
import { baseLogger, cloneValue, jsonType } from './providerShared'
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from './types'
import { OpenAIProvider } from './providers/openaiProvider'
import { DeepseekProvider } from './providers/deepseekProvider'
import { AnthropicProvider } from './providers/anthropicProvider'
import { OpenRouterProvider } from './providers/openrouterProvider'
import { MockProvider } from './providers/mockProvider'

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

function createProvider(forceMock = false): TranslationProviderAdapter {
  try {
    // Check for mock mode override or global mock setting
    if (forceMock || isMockModeEnabled()) {
      baseLogger.info('Mock translation provider enabled', {
        forceMock,
        globalMockMode: isMockModeEnabled(),
      })
      return new MockProvider()
    }

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

    if (config.provider === 'mock') {
      return new MockProvider()
    }
    if (config.provider === 'openai') {
      return new OpenAIProvider(config.providerConfig)
    }
    if (config.provider === 'anthropic') {
      return new AnthropicProvider(config.providerConfig)
    }
    if (config.provider === 'deepseek') {
      return new DeepseekProvider(config.providerConfig)
    }
    if (config.provider === 'openrouter') {
      return new OpenRouterProvider(config.providerConfig)
    }

    return new NoOpTranslationProvider()
  } catch (error) {
    baseLogger.warn('Falling back to no-op translation provider', { error })
    return new NoOpTranslationProvider()
  }
}

/**
 * Get the current translation provider.
 * Uses cached instance unless mock mode is requested.
 */
export function getTranslationProvider(options?: { useMock?: boolean }): TranslationProviderAdapter {
  const useMock = options?.useMock ?? false

  // If mock is specifically requested, return a mock provider (not cached)
  if (useMock) {
    return new MockProvider()
  }

  if (!cachedProvider) {
    cachedProvider = createProvider()
  }
  return cachedProvider
}

/**
 * Get information about the current translation mode
 */
export function getTranslationModeInfo(): {
  provider: string
  isMockMode: boolean
  globalMockEnabled: boolean
} {
  const globalMockEnabled = isMockModeEnabled()
  const provider = cachedProvider?.name ?? 'unknown'
  const isMockMode = globalMockEnabled || provider === 'mock'

  return {
    provider,
    isMockMode,
    globalMockEnabled,
  }
}
