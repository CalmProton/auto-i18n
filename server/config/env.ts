import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScopedLogger } from '../utils/logger'

export type TranslationProvider = 'openai' | 'anthropic' | 'deepseek' | 'mock'

export type ProviderConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
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
  if (normalized === 'mock') {
    return 'mock'
  }
  if (normalized === 'anthropic') {
    return 'anthropic'
  }
  if (normalized === 'deepseek') {
    return 'deepseek'
  }
  return 'openai'
}

/**
 * Check if mock translation mode is enabled globally.
 * This can be set via MOCK_TRANSLATIONS=true env var or TRANSLATION_PROVIDER=mock
 */
export function isMockModeEnabled(): boolean {
  ensureEnvLoaded()
  const mockEnv = readEnv('MOCK_TRANSLATIONS')
  if (mockEnv?.toLowerCase() === 'true' || mockEnv === '1') {
    return true
  }
  return toTranslationProvider(readEnv('TRANSLATION_PROVIDER')) === 'mock'
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

function readProviderConfig(keyEnv: string, modelEnv: string, urlEnv?: string): ProviderConfig | undefined {
  const apiKey = readEnv(keyEnv)
  if (!apiKey) {
    return undefined
  }
  const model = readEnv(modelEnv)
  const baseUrl = urlEnv ? readEnv(urlEnv) : undefined
  const config: ProviderConfig = { apiKey }
  if (model) {
    config.model = model
  }
  if (baseUrl) {
    config.baseUrl = baseUrl
  }
  return config
}

export function loadTranslationConfig(): TranslationConfig {
  const provider = toTranslationProvider(readEnv('TRANSLATION_PROVIDER'))

  // Mock provider doesn't need any configuration
  if (provider === 'mock') {
    log.info('Mock translation provider enabled - no API calls will be made')
    return {
      provider: 'mock',
      providerConfig: { apiKey: 'mock' },
      providers: {}
    }
  }

  const openaiConfig = readProviderConfig('OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_API_URL')
  const anthropicConfig = readProviderConfig('ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_API_URL')
  const deepseekConfig = readProviderConfig('DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_API_URL')

  const providers: Partial<Record<TranslationProvider, ProviderConfig>> = {}
  if (openaiConfig) {
    providers.openai = openaiConfig
  }
  if (anthropicConfig) {
    providers.anthropic = anthropicConfig
  }
  if (deepseekConfig) {
    providers.deepseek = deepseekConfig
  }

  const providerConfig = providers[provider]

  if (!providerConfig) {
    const missing = provider === 'openai'
      ? ['OPENAI_API_KEY']
      : provider === 'anthropic'
        ? ['ANTHROPIC_API_KEY']
        : ['DEEPSEEK_API_KEY']
    throw new Error(
      `Translation provider "${provider}" is selected but missing configuration. ` +
      `Expected env vars: ${missing.join(', ')}`
    )
  }

  log.info('Loaded translation provider configuration', {
    provider,
    openaiConfigured: Boolean(openaiConfig),
    anthropicConfigured: Boolean(anthropicConfig),
    deepseekConfigured: Boolean(deepseekConfig)
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

// Database configuration
export interface DatabaseConfig {
  url: string
  maxConnections?: number
  idleTimeout?: number
}

export interface RedisConfig {
  url: string
  maxRetries?: number
  connectionTimeout?: number
}

export function getDatabaseConfig(): DatabaseConfig {
  ensureEnvLoaded()
  const url = readEnv('DATABASE_URL')
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required')
  }
  return {
    url,
    maxConnections: Number(readEnv('DB_MAX_CONNECTIONS')) || 20,
    idleTimeout: Number(readEnv('DB_IDLE_TIMEOUT')) || 30000,
  }
}

export function getRedisConfig(): RedisConfig {
  ensureEnvLoaded()
  const url = readEnv('REDIS_URL') || readEnv('VALKEY_URL') || 'redis://localhost:6379'
  return {
    url,
    maxRetries: Number(readEnv('REDIS_MAX_RETRIES')) || 10,
    connectionTimeout: Number(readEnv('REDIS_CONNECTION_TIMEOUT')) || 10000,
  }
}
