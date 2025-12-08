/**
 * Database module exports
 * Provides unified access to PostgreSQL and Redis connections
 */

// PostgreSQL connection and utilities (Drizzle ORM)
export {
  getDatabase,
  getSqlClient,
  isDatabaseConnected,
  closeDatabase,
  transaction,
  initializeDatabase,
  healthCheck as databaseHealthCheck,
  schema,
  type Database,
} from './connection'

// Re-export schema types and tables
export * from './schema'

// Redis/DragonflyDB connection and utilities
export {
  getRedis,
  getSubscriber,
  closeRedis,
  isRedisConnected,
  initializeRedis,
  healthCheck as redisHealthCheck,
  // Cache utilities
  cacheGet,
  cacheSet,
  cacheSetNX,
  cacheDel,
  cacheDelPattern,
  cacheExists,
  // Pub/Sub utilities
  publish,
  subscribe,
  unsubscribe,
  type RedisClient,
  type MessageHandler,
} from './redis'

/**
 * Initialize all database connections
 */
export async function initializeAll(): Promise<void> {
  const { initializeDatabase } = await import('./connection')
  const { initializeRedis } = await import('./redis')
  
  await Promise.all([
    initializeDatabase(),
    initializeRedis(),
  ])
}

/**
 * Close all database connections
 */
export async function closeAll(): Promise<void> {
  const { closeDatabase } = await import('./connection')
  const { closeRedis } = await import('./redis')
  
  await closeDatabase()
  closeRedis()
}

/**
 * Health check for all database connections
 */
export async function healthCheckAll(): Promise<{
  database: { healthy: boolean; latencyMs: number; error?: string }
  redis: { healthy: boolean; latencyMs: number; error?: string }
  overall: boolean
}> {
  const { healthCheck: dbHealth } = await import('./connection')
  const { healthCheck: redisHealth } = await import('./redis')
  
  const [database, redis] = await Promise.all([
    dbHealth(),
    redisHealth(),
  ])
  
  return {
    database,
    redis,
    overall: database.healthy && redis.healthy,
  }
}
