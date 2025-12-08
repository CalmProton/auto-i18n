/**
 * Cache Module
 * Provides high-level caching utilities for common operations
 * Uses DragonflyDB (Redis-compatible) as the backing store
 */
import { 
  cacheGet, 
  cacheSet,
  cacheSetNX,
  cacheDel, 
  cacheDelPattern, 
  publish,
  subscribe,
  type MessageHandler
} from '../database/redis'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('cache')

// ============================================================================
// CACHE KEY PATTERNS
// ============================================================================

export const CacheKeys = {
  // Session cache
  session: (senderId: string) => `session:${senderId}`,
  sessionStatus: (senderId: string) => `session:${senderId}:status`,
  
  // Batch cache
  batch: (batchId: string) => `batch:${batchId}`,
  batchStatus: (batchId: string) => `batch:${batchId}:status`,
  
  // Dashboard stats
  dashboardStats: () => 'dashboard:stats',
  dashboardUploads: (page: number, limit: number) => `dashboard:uploads:${page}:${limit}`,
  dashboardBatches: (page: number, limit: number) => `dashboard:batches:${page}:${limit}`,
  
  // Rate limiting
  rateLimit: (key: string) => `ratelimit:${key}`,
  
  // Translation progress
  translationProgress: (senderId: string) => `translation:${senderId}:progress`,
  
  // Locks
  lock: (resource: string) => `lock:${resource}`,
} as const

// ============================================================================
// CACHE TTL VALUES (in seconds)
// ============================================================================

export const CacheTTL = {
  session: 300,          // 5 minutes
  sessionStatus: 60,     // 1 minute
  batch: 60,             // 1 minute
  batchStatus: 30,       // 30 seconds
  dashboardStats: 60,    // 1 minute
  dashboardList: 30,     // 30 seconds
  translationProgress: 60, // 1 minute
  lock: 30,              // 30 seconds (max lock duration)
} as const

// ============================================================================
// PUB/SUB CHANNELS
// ============================================================================

export const Channels = {
  // Session events
  sessionCreated: 'events:session:created',
  sessionUpdated: 'events:session:updated',
  sessionDeleted: 'events:session:deleted',
  
  // Batch events
  batchCreated: 'events:batch:created',
  batchStatusChanged: 'events:batch:status',
  batchCompleted: 'events:batch:completed',
  batchFailed: 'events:batch:failed',
  
  // Translation events
  translationStarted: 'events:translation:started',
  translationProgress: 'events:translation:progress',
  translationCompleted: 'events:translation:completed',
  
  // File events
  fileUploaded: 'events:file:uploaded',
  fileTranslated: 'events:file:translated',
} as const

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface SessionEvent {
  senderId: string
  sessionType: string
  status?: string
  timestamp: string
}

export interface BatchEvent {
  batchId: string
  senderId: string
  status: string
  progress?: {
    total: number
    completed: number
    failed: number
  }
  timestamp: string
}

export interface TranslationEvent {
  senderId: string
  fileId?: string
  relativePath?: string
  sourceLocale: string
  targetLocale: string
  status: 'started' | 'progress' | 'completed' | 'failed'
  timestamp: string
}

export interface FileEvent {
  senderId: string
  fileId: string
  relativePath: string
  locale: string
  contentType: string
  timestamp: string
}

// ============================================================================
// DASHBOARD CACHE HELPERS
// ============================================================================

export interface DashboardStats {
  totalSessions: number
  activeSessions: number
  totalBatches: number
  pendingBatches: number
  completedBatches: number
  failedBatches: number
  totalFiles: number
  totalTranslations: number
  updatedAt: string
}

/**
 * Get cached dashboard stats
 */
export async function getDashboardStats(): Promise<DashboardStats | null> {
  return cacheGet<DashboardStats>(CacheKeys.dashboardStats(), true)
}

/**
 * Set dashboard stats cache
 */
export async function setDashboardStats(stats: DashboardStats): Promise<void> {
  await cacheSet(CacheKeys.dashboardStats(), stats, CacheTTL.dashboardStats)
}

/**
 * Invalidate all dashboard caches
 */
export async function invalidateDashboardCache(): Promise<void> {
  await cacheDelPattern('dashboard:*')
  log.debug('Invalidated dashboard cache')
}

// ============================================================================
// SESSION CACHE HELPERS
// ============================================================================

/**
 * Invalidate session cache
 */
export async function invalidateSessionCache(senderId: string): Promise<void> {
  await Promise.all([
    cacheDel(CacheKeys.session(senderId)),
    cacheDel(CacheKeys.sessionStatus(senderId)),
    cacheDel(CacheKeys.translationProgress(senderId)),
  ])
}

// ============================================================================
// BATCH CACHE HELPERS
// ============================================================================

/**
 * Invalidate batch cache
 */
export async function invalidateBatchCache(batchId: string): Promise<void> {
  await Promise.all([
    cacheDel(CacheKeys.batch(batchId)),
    cacheDel(CacheKeys.batchStatus(batchId)),
  ])
}

// ============================================================================
// DISTRIBUTED LOCK
// ============================================================================

/**
 * Acquire a distributed lock atomically
 * Returns true if lock was acquired, false otherwise
 * Uses SETNX to avoid race conditions
 */
export async function acquireLock(resource: string, ttlSeconds: number = CacheTTL.lock): Promise<boolean> {
  const key = CacheKeys.lock(resource)
  // Use atomic SETNX operation - only sets if key doesn't exist
  return await cacheSetNX(key, { lockedAt: new Date().toISOString() }, ttlSeconds)
}

/**
 * Release a distributed lock
 */
export async function releaseLock(resource: string): Promise<void> {
  await cacheDel(CacheKeys.lock(resource))
}

/**
 * Execute a function with a distributed lock
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttlSeconds: number = CacheTTL.lock
): Promise<T | null> {
  const acquired = await acquireLock(resource, ttlSeconds)
  
  if (!acquired) {
    log.debug('Failed to acquire lock', { resource })
    return null
  }
  
  try {
    return await fn()
  } finally {
    await releaseLock(resource)
  }
}

// ============================================================================
// EVENT PUBLISHING
// ============================================================================

/**
 * Publish a session event
 */
export async function publishSessionEvent(
  channel: typeof Channels.sessionCreated | typeof Channels.sessionUpdated | typeof Channels.sessionDeleted,
  event: SessionEvent
): Promise<void> {
  await publish(channel, event)
  log.debug('Published session event', { channel, senderId: event.senderId })
}

/**
 * Publish a batch event
 */
export async function publishBatchEvent(
  channel: typeof Channels.batchCreated | typeof Channels.batchStatusChanged | typeof Channels.batchCompleted | typeof Channels.batchFailed,
  event: BatchEvent
): Promise<void> {
  await publish(channel, event)
  log.debug('Published batch event', { channel, batchId: event.batchId })
}

/**
 * Publish a translation event
 */
export async function publishTranslationEvent(
  channel: typeof Channels.translationStarted | typeof Channels.translationProgress | typeof Channels.translationCompleted,
  event: TranslationEvent
): Promise<void> {
  await publish(channel, event)
  log.debug('Published translation event', { channel, senderId: event.senderId })
}

/**
 * Publish a file event
 */
export async function publishFileEvent(
  channel: typeof Channels.fileUploaded | typeof Channels.fileTranslated,
  event: FileEvent
): Promise<void> {
  await publish(channel, event)
  log.debug('Published file event', { channel, fileId: event.fileId })
}

// ============================================================================
// EVENT SUBSCRIPTION
// ============================================================================

/**
 * Subscribe to session events
 */
export async function subscribeToSessionEvents(handler: (event: SessionEvent) => void): Promise<void> {
  const messageHandler: MessageHandler = (message) => {
    try {
      const event = JSON.parse(message) as SessionEvent
      handler(event)
    } catch (error) {
      log.error('Failed to parse session event', { error })
    }
  }
  
  await subscribe(Channels.sessionCreated, messageHandler)
  await subscribe(Channels.sessionUpdated, messageHandler)
  await subscribe(Channels.sessionDeleted, messageHandler)
}

/**
 * Subscribe to batch events
 */
export async function subscribeToBatchEvents(handler: (event: BatchEvent) => void): Promise<void> {
  const messageHandler: MessageHandler = (message) => {
    try {
      const event = JSON.parse(message) as BatchEvent
      handler(event)
    } catch (error) {
      log.error('Failed to parse batch event', { error })
    }
  }
  
  await subscribe(Channels.batchCreated, messageHandler)
  await subscribe(Channels.batchStatusChanged, messageHandler)
  await subscribe(Channels.batchCompleted, messageHandler)
  await subscribe(Channels.batchFailed, messageHandler)
}

/**
 * Subscribe to translation events
 */
export async function subscribeToTranslationEvents(handler: (event: TranslationEvent) => void): Promise<void> {
  const messageHandler: MessageHandler = (message) => {
    try {
      const event = JSON.parse(message) as TranslationEvent
      handler(event)
    } catch (error) {
      log.error('Failed to parse translation event', { error })
    }
  }
  
  await subscribe(Channels.translationStarted, messageHandler)
  await subscribe(Channels.translationProgress, messageHandler)
  await subscribe(Channels.translationCompleted, messageHandler)
}
