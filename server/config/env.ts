import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScopedLogger } from '../utils/logger'

export type TranslationProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'mock'

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

// Flag to prevent DB lookups during initialization
let dbInitialized = false

/**
 * Mark the database as initialized and ready for config lookups
 */
export function markDatabaseInitialized(): void {
  dbInitialized = true
}

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
  if (normalized === 'openrouter') {
    return 'openrouter'
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
  const openrouterConfig = readProviderConfig('OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_API_URL')

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
  if (openrouterConfig) {
    providers.openrouter = openrouterConfig
  }

  const providerConfig = providers[provider]

  if (!providerConfig) {
    const missing = provider === 'openai'
      ? ['OPENAI_API_KEY']
      : provider === 'anthropic'
        ? ['ANTHROPIC_API_KEY']
        : provider === 'openrouter'
          ? ['OPENROUTER_API_KEY']
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
    deepseekConfigured: Boolean(deepseekConfig),
    openrouterConfigured: Boolean(openrouterConfig)
  })

  return { provider, providerConfig, providers }
}

let cachedConfig: TranslationConfig | null = null
let cachedAsyncConfig: TranslationConfig | null = null

export function getTranslationConfig(): TranslationConfig {
  if (!cachedConfig) {
    cachedConfig = loadTranslationConfig()
  }
  return cachedConfig
}

export function resetTranslationConfigCache(): void {
  cachedConfig = null
  cachedAsyncConfig = null
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

// ============================================================================
// ASYNC DB-FIRST CONFIGURATION LOADING
// These functions check the database first, then fall back to environment variables
// ============================================================================

/**
 * Check if mock translation mode is enabled.
 * Checks database first, then falls back to environment variable.
 * Returns a promise to support async DB lookup.
 */
export async function isMockModeEnabledAsync(): Promise<boolean> {
  // Only check DB if it's initialized
  if (dbInitialized) {
    try {
      // Dynamic import to avoid circular dependency
      const { isMockModeEnabledFromDb } = await import('../repositories/configRepository')
      const dbValue = await isMockModeEnabledFromDb()
      if (dbValue !== null) {
        return dbValue
      }
    } catch (error) {
      log.warn('Failed to check mock mode from database, falling back to env', { error })
    }
  }

  // Fall back to synchronous env check
  return isMockModeEnabled()
}

/**
 * Load translation configuration asynchronously.
 * Checks database for API keys and settings first, then falls back to env vars.
 */
export async function loadTranslationConfigAsync(): Promise<TranslationConfig> {
  if (!dbInitialized) {
    // Database not ready, use sync version
    return loadTranslationConfig()
  }

  try {
    // Dynamic import to avoid circular dependency
    const {
      getConfig,
      getDecryptedConfig,
      ConfigKeys,
    } = await import('../repositories/configRepository')

    // Check for mock mode first
    const mockConfig = await getConfig<boolean>(ConfigKeys.MOCK_TRANSLATIONS)
    if (mockConfig?.value === true) {
      log.info('Mock translation provider enabled from database')
      return {
        provider: 'mock',
        providerConfig: { apiKey: 'mock' },
        providers: {}
      }
    }

    // Get provider from DB, fall back to env
    const providerConfig = await getConfig<string>(ConfigKeys.TRANSLATION_PROVIDER)
    const provider = toTranslationProvider(providerConfig?.value ?? readEnv('TRANSLATION_PROVIDER'))

    if (provider === 'mock') {
      log.info('Mock translation provider enabled')
      return {
        provider: 'mock',
        providerConfig: { apiKey: 'mock' },
        providers: {}
      }
    }

    // Load provider configurations from DB, falling back to env vars
    const providers: Partial<Record<TranslationProvider, ProviderConfig>> = {}

    // OpenAI
    const openaiKey = await getDecryptedConfig(ConfigKeys.OPENAI_API_KEY) ?? readEnv('OPENAI_API_KEY')
    if (openaiKey) {
      const openaiModel = (await getConfig<string>(ConfigKeys.OPENAI_MODEL))?.value ?? readEnv('OPENAI_MODEL')
      const openaiUrl = readEnv('OPENAI_API_URL')
      providers.openai = {
        apiKey: openaiKey,
        model: openaiModel,
        baseUrl: openaiUrl,
      }
    }

    // Anthropic
    const anthropicKey = await getDecryptedConfig(ConfigKeys.ANTHROPIC_API_KEY) ?? readEnv('ANTHROPIC_API_KEY')
    if (anthropicKey) {
      const anthropicModel = (await getConfig<string>(ConfigKeys.ANTHROPIC_MODEL))?.value ?? readEnv('ANTHROPIC_MODEL')
      const anthropicUrl = readEnv('ANTHROPIC_API_URL')
      providers.anthropic = {
        apiKey: anthropicKey,
        model: anthropicModel,
        baseUrl: anthropicUrl,
      }
    }

    // DeepSeek
    const deepseekKey = await getDecryptedConfig(ConfigKeys.DEEPSEEK_API_KEY) ?? readEnv('DEEPSEEK_API_KEY')
    if (deepseekKey) {
      const deepseekModel = (await getConfig<string>(ConfigKeys.DEEPSEEK_MODEL))?.value ?? readEnv('DEEPSEEK_MODEL')
      const deepseekUrl = readEnv('DEEPSEEK_API_URL')
      providers.deepseek = {
        apiKey: deepseekKey,
        model: deepseekModel,
        baseUrl: deepseekUrl,
      }
    }

    // OpenRouter
    const openrouterKey = await getDecryptedConfig(ConfigKeys.OPENROUTER_API_KEY) ?? readEnv('OPENROUTER_API_KEY')
    if (openrouterKey) {
      const openrouterModel = (await getConfig<string>(ConfigKeys.OPENROUTER_MODEL))?.value ?? readEnv('OPENROUTER_MODEL')
      providers.openrouter = {
        apiKey: openrouterKey,
        model: openrouterModel,
        baseUrl: 'https://openrouter.ai/api',
      }
    }

    const selectedProviderConfig = providers[provider]

    if (!selectedProviderConfig) {
      // Check if there's a default model configured - if not, fail
      const defaultModel = await getConfig<string>(ConfigKeys.DEFAULT_MODEL)
      if (!defaultModel?.value) {
        throw new Error(
          `Translation provider "${provider}" is selected but no API key is configured. ` +
          `Please configure the API key in Settings or via environment variables.`
        )
      }
      
      throw new Error(
        `Translation provider "${provider}" is selected but missing configuration.`
      )
    }

    log.info('Loaded translation provider configuration from database', {
      provider,
      openaiConfigured: Boolean(providers.openai),
      anthropicConfigured: Boolean(providers.anthropic),
      deepseekConfigured: Boolean(providers.deepseek),
      openrouterConfigured: Boolean(providers.openrouter),
    })

    return { provider, providerConfig: selectedProviderConfig, providers }
  } catch (error) {
    log.warn('Failed to load config from database, falling back to env', { error })
    return loadTranslationConfig()
  }
}

/**
 * Get translation configuration with database-first lookup.
 * Use this when you need the most up-to-date configuration.
 */
export async function getTranslationConfigAsync(): Promise<TranslationConfig> {
  if (!cachedAsyncConfig) {
    cachedAsyncConfig = await loadTranslationConfigAsync()
  }
  return cachedAsyncConfig
}

/**
 * Reset both sync and async config caches
 */
export function resetAllConfigCaches(): void {
  cachedConfig = null
  cachedAsyncConfig = null
  envLoaded = false
}
