export type TranslationProvider = 'openai' | 'anthropic'

export type ProviderConfig = {
  url: string
  apiKey: string
  model?: string
}

type TranslationConfig = {
  provider: TranslationProvider
  providerConfig: ProviderConfig
  providers: Partial<Record<TranslationProvider, ProviderConfig>>
}

function toTranslationProvider(value: string | undefined): TranslationProvider {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'anthropic') {
    return 'anthropic'
  }
  return 'openai'
}

function readEnv(name: string): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env[name]
  }
  if (typeof process !== 'undefined') {
    return process.env?.[name]
  }
  return undefined
}

function readProviderConfig(urlEnv: string, keyEnv: string, modelEnv: string): ProviderConfig | undefined {
  const url = readEnv(urlEnv)
  const apiKey = readEnv(keyEnv)
  if (!url || !apiKey) {
    return undefined
  }
  const model = readEnv(modelEnv)
  return model ? { url, apiKey, model } : { url, apiKey }
}

export function loadTranslationConfig(): TranslationConfig {
  const provider = toTranslationProvider(readEnv('TRANSLATION_PROVIDER'))

  const openaiConfig = readProviderConfig('OPENAI_API_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL')
  const anthropicConfig = readProviderConfig('ANTHROPIC_API_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL')

  const providers: Partial<Record<TranslationProvider, ProviderConfig>> = {}
  if (openaiConfig) {
    providers.openai = openaiConfig
  }
  if (anthropicConfig) {
    providers.anthropic = anthropicConfig
  }

  const providerConfig = providers[provider]

  if (!providerConfig) {
    const missing = provider === 'openai'
      ? ['OPENAI_API_URL', 'OPENAI_API_KEY']
      : ['ANTHROPIC_API_URL', 'ANTHROPIC_API_KEY']
    throw new Error(
      `Translation provider "${provider}" is selected but missing configuration. ` +
      `Expected env vars: ${missing.join(', ')}`
    )
  }

  return { provider, providerConfig, providers }
}

let cachedConfig: TranslationConfig | null = null

export function getTranslationConfig(): TranslationConfig {
  if (!cachedConfig) {
    cachedConfig = loadTranslationConfig()
  }
  return cachedConfig
}
