/**
 * Config Repository
 * Handles CRUD operations for system configuration using Drizzle ORM
 * Supports encrypted storage for sensitive values (API keys)
 */
import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { systemConfig } from '../database/schema'
import type { SystemConfig, NewSystemConfig } from '../database/schema'
import { cacheDel, cacheGet, cacheSet } from '../database/redis'
import { createScopedLogger } from '../utils/logger'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const log = createScopedLogger('repository:config')

// Cache TTL in seconds
const CONFIG_CACHE_TTL = 600 // 10 minutes

// Encryption settings
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

// ============================================================================
// TYPES
// ============================================================================

export type { SystemConfig }

export interface ConfigValue<T = unknown> {
  key: string
  value: T
  isSensitive: boolean
  maskedPreview?: string
  updatedAt: Date
}

export interface SetConfigInput<T = unknown> {
  key: string
  value: T
  description?: string
  isSensitive?: boolean
}

// Well-known config keys
export const ConfigKeys = {
  MOCK_TRANSLATIONS: 'mock_translations',
  TRANSLATION_PROVIDER: 'translation_provider',
  DEFAULT_MODEL: 'default_model',
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_MODEL: 'openai_model',
  OPENAI_API_URL: 'openai_api_url',
  ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTHROPIC_MODEL: 'anthropic_model',
  ANTHROPIC_API_URL: 'anthropic_api_url',
  DEEPSEEK_API_KEY: 'deepseek_api_key',
  DEEPSEEK_MODEL: 'deepseek_model',
  DEEPSEEK_API_URL: 'deepseek_api_url',
  OPENROUTER_API_KEY: 'openrouter_api_key',
  OPENROUTER_MODEL: 'openrouter_model',
} as const

export type ConfigKey = typeof ConfigKeys[keyof typeof ConfigKeys]

// ============================================================================
// ENCRYPTION HELPERS
// ============================================================================

function getEncryptionKey(): Buffer {
  // Use a secret from environment or generate a deterministic one from a seed
  const secret = process.env.CONFIG_ENCRYPTION_SECRET || 'auto-i18n-default-secret-change-me'
  return scryptSync(secret, 'auto-i18n-salt', ENCRYPTION_KEY_LENGTH)
}

function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag()
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function decrypt(encryptedText: string): string {
  const key = getEncryptionKey()
  const parts = encryptedText.split(':')
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format')
  }
  
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = parts[2]
  
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

function createMaskedPreview(value: string): string {
  if (value.length <= 5) {
    return '*'.repeat(value.length)
  }
  const visiblePart = value.slice(-5)
  const maskedLength = Math.min(value.length - 5, 20)
  return '*'.repeat(maskedLength) + visiblePart
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

function configCacheKey(key: string): string {
  return `config:${key}`
}

function allConfigCacheKey(): string {
  return 'config:all'
}

async function invalidateConfigCache(key: string): Promise<void> {
  await Promise.all([
    cacheDel(configCacheKey(key)),
    cacheDel(allConfigCacheKey()),
  ])
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

/**
 * Get a configuration value by key
 */
export async function getConfig<T = unknown>(key: string): Promise<ConfigValue<T> | null> {
  // Try cache first
  const cached = await cacheGet<SystemConfig>(configCacheKey(key), true)
  if (cached) {
    return transformConfig<T>(cached)
  }

  const db = getDatabase()
  const result = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1)

  if (result.length === 0) {
    return null
  }

  const config = result[0]
  
  // Cache the result
  await cacheSet(configCacheKey(key), config, CONFIG_CACHE_TTL)

  return transformConfig<T>(config)
}

/**
 * Get all configuration values
 */
export async function getAllConfig(): Promise<ConfigValue[]> {
  // Try cache first
  const cached = await cacheGet<SystemConfig[]>(allConfigCacheKey(), true)
  if (cached) {
    return cached.map(c => transformConfig(c))
  }

  const db = getDatabase()
  const result = await db
    .select()
    .from(systemConfig)
    .orderBy(systemConfig.key)

  // Cache the result
  await cacheSet(allConfigCacheKey(), result, CONFIG_CACHE_TTL)

  return result.map(c => transformConfig(c))
}

/**
 * Set a configuration value (create or update)
 */
export async function setConfig<T = unknown>(input: SetConfigInput<T>): Promise<ConfigValue<T>> {
  const db = getDatabase()
  const isSensitive = input.isSensitive ?? false
  const now = new Date()

  let encryptedValue: string | null = null
  let maskedPreview: string | null = null
  let storedValue: unknown = input.value

  // For sensitive values, encrypt the actual value
  if (isSensitive && typeof input.value === 'string') {
    encryptedValue = encrypt(input.value)
    maskedPreview = createMaskedPreview(input.value)
    // Store a placeholder in the value field
    storedValue = '[ENCRYPTED]'
  }

  // Check if exists
  const existing = await db
    .select({ id: systemConfig.id })
    .from(systemConfig)
    .where(eq(systemConfig.key, input.key))
    .limit(1)

  let config: SystemConfig

  if (existing.length > 0) {
    // Update
    const [updated] = await db
      .update(systemConfig)
      .set({
        value: storedValue,
        encryptedValue,
        maskedPreview,
        description: input.description,
        isSensitive: isSensitive ? 'true' : 'false',
        updatedAt: now,
      })
      .where(eq(systemConfig.key, input.key))
      .returning()
    config = updated
    log.info('Updated config', { key: input.key, isSensitive })
  } else {
    // Insert
    const [inserted] = await db
      .insert(systemConfig)
      .values({
        key: input.key,
        value: storedValue,
        encryptedValue,
        maskedPreview,
        description: input.description,
        isSensitive: isSensitive ? 'true' : 'false',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    config = inserted
    log.info('Created config', { key: input.key, isSensitive })
  }

  // Invalidate cache
  await invalidateConfigCache(input.key)

  return transformConfig<T>(config)
}

/**
 * Delete a configuration value
 */
export async function deleteConfig(key: string): Promise<boolean> {
  const db = getDatabase()

  const result = await db
    .delete(systemConfig)
    .where(eq(systemConfig.key, key))
    .returning({ id: systemConfig.id })

  if (result.length > 0) {
    await invalidateConfigCache(key)
    log.info('Deleted config', { key })
    return true
  }

  return false
}

/**
 * Get the decrypted value of a sensitive config
 */
export async function getDecryptedConfig(key: string): Promise<string | null> {
  const db = getDatabase()
  
  const result = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1)

  if (result.length === 0) {
    return null
  }

  const config = result[0]
  
  if (config.isSensitive !== 'true' || !config.encryptedValue) {
    // Not encrypted, return value as string
    return typeof config.value === 'string' ? config.value : JSON.stringify(config.value)
  }

  try {
    return decrypt(config.encryptedValue)
  } catch (error) {
    log.error('Failed to decrypt config value', { key, error })
    return null
  }
}

/**
 * Check if a config key exists
 */
export async function hasConfig(key: string): Promise<boolean> {
  const config = await getConfig(key)
  return config !== null
}

/**
 * Get multiple config values by keys
 */
export async function getConfigBatch(keys: string[]): Promise<Map<string, ConfigValue>> {
  const db = getDatabase()
  const result = new Map<string, ConfigValue>()

  // Fetch all and filter (simpler than building OR query)
  const all = await getAllConfig()
  
  for (const config of all) {
    if (keys.includes(config.key)) {
      result.set(config.key, config)
    }
  }

  return result
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function transformConfig<T = unknown>(config: SystemConfig): ConfigValue<T> {
  let value: T

  if (config.isSensitive === 'true') {
    // For sensitive values, don't expose the actual value
    // Return the masked preview instead
    value = (config.maskedPreview ?? '[ENCRYPTED]') as T
  } else {
    value = config.value as T
  }

  return {
    key: config.key,
    value,
    isSensitive: config.isSensitive === 'true',
    maskedPreview: config.maskedPreview ?? undefined,
    updatedAt: config.updatedAt,
  }
}

// ============================================================================
// CONVENIENCE METHODS FOR COMMON CONFIG
// ============================================================================

/**
 * Check if mock translations mode is enabled in database
 */
export async function isMockModeEnabledFromDb(): Promise<boolean | null> {
  const config = await getConfig<boolean>(ConfigKeys.MOCK_TRANSLATIONS)
  if (config === null) {
    return null // Not set in DB
  }
  return config.value === true
}

/**
 * Get the translation provider from database
 */
export async function getTranslationProviderFromDb(): Promise<string | null> {
  const config = await getConfig<string>(ConfigKeys.TRANSLATION_PROVIDER)
  return config?.value ?? null
}

/**
 * Get the default model from database
 */
export async function getDefaultModelFromDb(): Promise<string | null> {
  const config = await getConfig<string>(ConfigKeys.DEFAULT_MODEL)
  return config?.value ?? null
}

/**
 * Get provider API key from database (decrypted)
 */
export async function getProviderApiKeyFromDb(provider: 'openai' | 'anthropic' | 'deepseek' | 'openrouter'): Promise<string | null> {
  const keyMap: Record<string, string> = {
    openai: ConfigKeys.OPENAI_API_KEY,
    anthropic: ConfigKeys.ANTHROPIC_API_KEY,
    deepseek: ConfigKeys.DEEPSEEK_API_KEY,
    openrouter: ConfigKeys.OPENROUTER_API_KEY,
  }
  
  const configKey = keyMap[provider]
  if (!configKey) {
    return null
  }

  return getDecryptedConfig(configKey)
}

/**
 * Get provider model from database
 */
export async function getProviderModelFromDb(provider: 'openai' | 'anthropic' | 'deepseek' | 'openrouter'): Promise<string | null> {
  const keyMap: Record<string, string> = {
    openai: ConfigKeys.OPENAI_MODEL,
    anthropic: ConfigKeys.ANTHROPIC_MODEL,
    deepseek: ConfigKeys.DEEPSEEK_MODEL,
    openrouter: ConfigKeys.OPENROUTER_MODEL,
  }
  
  const configKey = keyMap[provider]
  if (!configKey) {
    return null
  }

  const config = await getConfig<string>(configKey)
  return config?.value ?? null
}
