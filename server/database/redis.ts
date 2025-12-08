/**
 * Redis/DragonflyDB connection module using Bun's native Redis client
 */
import { RedisClient } from 'bun'
import { getRedisConfig } from '../config/env'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('database:redis')

let redisClient: RedisClient | null = null
let subscriberClient: RedisClient | null = null

/**
 * Get the main Redis client instance
 * Creates a new connection if one doesn't exist
 */
export function getRedis(): RedisClient {
  if (!redisClient) {
    const config = getRedisConfig()
    log.info('Initializing Redis/DragonflyDB connection', { 
      url: config.url.replace(/:[^:@]+@/, ':***@') // Mask password in logs
    })
    
    redisClient = new RedisClient(config.url, {
      connectionTimeout: config.connectionTimeout,
      maxRetries: config.maxRetries,
      autoReconnect: true,
      enableAutoPipelining: true,
      enableOfflineQueue: true,
    })
    
    redisClient.onconnect = () => {
      log.info('Redis connection established')
    }
    
    redisClient.onclose = (error) => {
      log.warn('Redis connection closed', { error })
    }
  }
  return redisClient
}

/**
 * Get a subscriber client for pub/sub operations
 * Pub/Sub requires a dedicated connection
 */
export async function getSubscriber(): Promise<RedisClient> {
  if (!subscriberClient) {
    const config = getRedisConfig()
    log.info('Creating Redis subscriber client')
    
    subscriberClient = new RedisClient(config.url, {
      connectionTimeout: config.connectionTimeout,
      maxRetries: config.maxRetries,
      autoReconnect: true,
    })
    
    await subscriberClient.connect()
  }
  return subscriberClient
}

/**
 * Close all Redis connections
 */
export function closeRedis(): void {
  if (redisClient) {
    log.info('Closing Redis main connection')
    redisClient.close()
    redisClient = null
  }
  if (subscriberClient) {
    log.info('Closing Redis subscriber connection')
    subscriberClient.close()
    subscriberClient = null
  }
}

/**
 * Check if Redis is connected
 */
export function isRedisConnected(): boolean {
  return redisClient?.connected ?? false
}

/**
 * Initialize Redis connection and verify connectivity
 */
export async function initializeRedis(): Promise<void> {
  const client = getRedis()
  
  log.info('Checking Redis connection...')
  
  try {
    await client.connect()
    const pong = await client.send('PING', [])
    if (pong === 'PONG') {
      log.info('Redis connection established and verified')
    }
  } catch (error) {
    log.error('Failed to connect to Redis', { error })
    throw error
  }
}

/**
 * Health check for Redis connection
 */
export async function healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = performance.now()
  
  try {
    const client = getRedis()
    await client.send('PING', [])
    const latencyMs = performance.now() - start
    
    return { healthy: true, latencyMs }
  } catch (error) {
    const latencyMs = performance.now() - start
    return { 
      healthy: false, 
      latencyMs, 
      error: error instanceof Error ? error.message : String(error) 
    }
  }
}

// ============================================================================
// CACHE UTILITIES
// ============================================================================

const DEFAULT_TTL = 3600 // 1 hour in seconds

/**
 * Get a cached value, optionally parsing as JSON
 */
export async function cacheGet<T = string>(key: string, parseJson = false): Promise<T | null> {
  const client = getRedis()
  const value = await client.get(key)
  
  if (value === null) {
    return null
  }
  
  if (parseJson) {
    try {
      return JSON.parse(value) as T
    } catch {
      return value as T
    }
  }
  
  return value as T
}

/**
 * Set a cached value with optional TTL
 * Uses atomic SET with EX for TTL to avoid race conditions
 */
export async function cacheSet(
  key: string, 
  value: string | object, 
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  const client = getRedis()
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
  
  if (ttlSeconds > 0) {
    // Use SET with EX atomically
    await client.send('SET', [key, stringValue, 'EX', String(ttlSeconds)])
  } else {
    await client.set(key, stringValue)
  }
}

/**
 * Delete a cached value
 */
export async function cacheDel(key: string): Promise<void> {
  const client = getRedis()
  await client.del(key)
}

/**
 * Delete multiple cached values by pattern
 * Note: Uses SCAN to avoid blocking
 */
export async function cacheDelPattern(pattern: string): Promise<number> {
  const client = getRedis()
  let deleted = 0
  let cursor = '0'
  
  do {
    const result = await client.send('SCAN', [cursor, 'MATCH', pattern, 'COUNT', '100']) as [string, string[]]
    cursor = result[0]
    const keys = result[1]
    
    if (keys.length > 0) {
      for (const key of keys) {
        await client.del(key)
        deleted++
      }
    }
  } while (cursor !== '0')
  
  return deleted
}

/**
 * Check if a key exists
 */
export async function cacheExists(key: string): Promise<boolean> {
  const client = getRedis()
  return await client.exists(key)
}

/**
 * Set a key only if it doesn't exist (atomic operation for locks)
 * Returns true if the key was set, false if it already existed
 */
export async function cacheSetNX(
  key: string,
  value: string | object,
  ttlSeconds?: number
): Promise<boolean> {
  const client = getRedis()
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
  
  // Use SET with NX (only set if not exists) and optional EX (expire)
  const args = [key, stringValue, 'NX']
  if (ttlSeconds && ttlSeconds > 0) {
    args.push('EX', String(ttlSeconds))
  }
  
  const result = await client.send('SET', args)
  return result === 'OK'
}

/**
 * Increment a counter with optional TTL
 */
export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  const client = getRedis()
  const count = await client.incr(key)
  
  if (ttlSeconds && count === 1) {
    await client.expire(key, ttlSeconds)
  }
  
  return count
}

// ============================================================================
// PUB/SUB UTILITIES
// ============================================================================

export type MessageHandler = (message: string, channel: string) => void

/**
 * Publish a message to a channel
 */
export async function publish(channel: string, message: string | object): Promise<void> {
  const client = getRedis()
  const stringMessage = typeof message === 'string' ? message : JSON.stringify(message)
  await client.publish(channel, stringMessage)
}

/**
 * Subscribe to a channel
 */
export async function subscribe(channel: string, handler: MessageHandler): Promise<void> {
  const subscriber = await getSubscriber()
  await subscriber.subscribe(channel, handler)
  log.debug('Subscribed to channel', { channel })
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribe(channel?: string): Promise<void> {
  if (subscriberClient) {
    if (channel) {
      await subscriberClient.unsubscribe(channel)
    } else {
      await subscriberClient.unsubscribe()
    }
    log.debug('Unsubscribed from channel', { channel })
  }
}

// Export the RedisClient type
export { RedisClient }
