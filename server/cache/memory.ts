/**
 * In-Memory Cache Module
 * 
 * Replaces Redis-based caching with a simple in-memory LRU cache.
 * For production deployments with multiple instances, consider using
 * PostgreSQL-based caching or a distributed cache.
 * 
 * Note: Pub/Sub events are replaced with a simple EventEmitter pattern.
 */
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('cache')

// ============================================================================
// LRU CACHE IMPLEMENTATION
// ============================================================================

interface CacheEntry<T> {
  value: T
  expiresAt: number | null
}

class LRUCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private maxSize: number
  
  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
  }
  
  get(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    
    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)
    
    return entry.value
  }
  
  set(key: string, value: T, ttlSeconds?: number): void {
    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) this.cache.delete(oldestKey)
    }
    
    this.cache.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null,
    })
  }
  
  delete(key: string): boolean {
    return this.cache.delete(key)
  }
  
  deletePattern(pattern: string): number {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    let deleted = 0
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key)
        deleted++
      }
    }
    
    return deleted
  }
  
  has(key: string): boolean {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return false
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    
    return true
  }
  
  clear(): void {
    this.cache.clear()
  }
  
  size(): number {
    return this.cache.size
  }
}

// Global cache instance
const cache = new LRUCache()

// ============================================================================
// CACHE UTILITIES
// ============================================================================

const DEFAULT_TTL = 3600 // 1 hour in seconds

/**
 * Get a cached value, optionally parsing as JSON
 */
export async function cacheGet<T = string>(key: string, parseJson = false): Promise<T | null> {
  const value = cache.get(key)
  
  if (value === null) {
    return null
  }
  
  if (parseJson && typeof value === 'string') {
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
 */
export async function cacheSet(
  key: string, 
  value: string | object, 
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
  cache.set(key, stringValue, ttlSeconds > 0 ? ttlSeconds : undefined)
}

/**
 * Delete a cached value
 */
export async function cacheDel(key: string): Promise<void> {
  cache.delete(key)
}

/**
 * Delete multiple cached values by pattern
 */
export async function cacheDelPattern(pattern: string): Promise<number> {
  return cache.deletePattern(pattern)
}

/**
 * Check if a key exists
 */
export async function cacheExists(key: string): Promise<boolean> {
  return cache.has(key)
}

/**
 * Set a key only if it doesn't exist (atomic operation for locks)
 */
export async function cacheSetNX(
  key: string,
  value: string | object,
  ttlSeconds?: number
): Promise<boolean> {
  if (cache.has(key)) {
    return false
  }
  
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
  cache.set(key, stringValue, ttlSeconds)
  return true
}

// ============================================================================
// SIMPLE PUB/SUB (In-Process Only)
// ============================================================================

type MessageHandler = (message: string, channel: string) => void

const subscribers: Map<string, Set<MessageHandler>> = new Map()

/**
 * Publish a message to a channel
 * Note: Only works within the same process
 */
export async function publish(channel: string, message: string | object): Promise<void> {
  const stringMessage = typeof message === 'string' ? message : JSON.stringify(message)
  const handlers = subscribers.get(channel)
  
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(stringMessage, channel)
      } catch (error) {
        log.error('Error in pub/sub handler', { channel, error })
      }
    }
  }
}

/**
 * Subscribe to a channel
 */
export async function subscribe(channel: string, handler: MessageHandler): Promise<void> {
  if (!subscribers.has(channel)) {
    subscribers.set(channel, new Set())
  }
  subscribers.get(channel)!.add(handler)
  log.debug('Subscribed to channel', { channel })
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribe(channel?: string, handler?: MessageHandler): Promise<void> {
  if (!channel) {
    subscribers.clear()
    return
  }
  
  if (handler) {
    subscribers.get(channel)?.delete(handler)
  } else {
    subscribers.delete(channel)
  }
  log.debug('Unsubscribed from channel', { channel })
}

export type { MessageHandler }
