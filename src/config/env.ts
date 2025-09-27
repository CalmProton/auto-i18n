import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScopedLogger } from '../utils/logger'

export type TranslationProvider = 'openai' | 'anthropic'

export type ProviderConfig = {
  apiKey: string
  model?: string
}

type TranslationConfig = {
  provider: TranslationProvider
  providerConfig: ProviderConfig
  providers: Partial<Record<TranslationProvider, ProviderConfig>>
}

let envLoaded = false
const log = createScopedLogger('config:env')

function ensureEnvLoaded(): void {
  if (envLoaded) {
    return
  }

  envLoaded = true

  if (typeof Bun !== 'undefined') {
    // Bun automatically loads `.env` files into Bun.env
    return
  }

  if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
    return
  }

  try {
    const envPath = resolve(process.cwd(), '.env')
    if (!existsSync(envPath)) {
      return
    }

    const content = readFileSync(envPath, 'utf8')
    const lines = content.split(/\r?\n/)

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }

      const [rawKey, ...rawValueParts] = line.split('=')
      if (!rawKey || rawValueParts.length === 0) {
        continue
      }

      const key = rawKey.replace(/^export\s+/i, '').trim()
      if (!key || key in process.env) {
        continue
      }

      let value = rawValueParts.join('=').trim()

      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      if (isQuoted) {
        value = value.slice(1, -1)
      }

      if (!isQuoted) {
        const hashIndex = value.indexOf(' #')
        if (hashIndex >= 0) {
          value = value.slice(0, hashIndex).trim()
        }
      }

      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')

      process.env[key] = value
    }
  } catch (error) {
    log.warn('Unable to automatically load .env file in Node runtime', { error })
  }
}

function toTranslationProvider(value: string | undefined): TranslationProvider {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'anthropic') {
    return 'anthropic'
  }
  return 'openai'
}

function readEnv(name: string): string | undefined {
  ensureEnvLoaded()
  if (typeof Bun !== 'undefined') {
    return Bun.env[name]
  }
  if (typeof process !== 'undefined') {
    return process.env?.[name]
  }
  return undefined
}

function readProviderConfig(keyEnv: string, modelEnv: string): ProviderConfig | undefined {
  const apiKey = readEnv(keyEnv)
  if (!apiKey) {
    return undefined
  }
  const model = readEnv(modelEnv)
  return model ? { apiKey, model } : { apiKey }
}

export function loadTranslationConfig(): TranslationConfig {
  const provider = toTranslationProvider(readEnv('TRANSLATION_PROVIDER'))

  const openaiConfig = readProviderConfig('OPENAI_API_KEY', 'OPENAI_MODEL')
  const anthropicConfig = readProviderConfig('ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL')

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
      ? ['OPENAI_API_KEY']
      : ['ANTHROPIC_API_KEY']
    throw new Error(
      `Translation provider "${provider}" is selected but missing configuration. ` +
      `Expected env vars: ${missing.join(', ')}`
    )
  }

  log.info('Loaded translation provider configuration', {
    provider,
    openaiConfigured: Boolean(openaiConfig),
    anthropicConfigured: Boolean(anthropicConfig)
  })

  return { provider, providerConfig, providers }
}

let cachedConfig: TranslationConfig | null = null

export function getTranslationConfig(): TranslationConfig {
  if (!cachedConfig) {
    cachedConfig = loadTranslationConfig()
  }
  return cachedConfig
}

export function resetTranslationConfigCache(): void {
  cachedConfig = null
  envLoaded = false
}
