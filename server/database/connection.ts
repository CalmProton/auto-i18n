/**
 * PostgreSQL connection module using Drizzle ORM with Bun's native SQL client
 */
import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import { getDatabaseConfig } from '../config/env'
import { createScopedLogger } from '../utils/logger'
import * as schema from './schema'

const log = createScopedLogger('database:connection')

let client: SQL | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let isConnected = false

/**
 * Get the raw SQL client (for special cases)
 */
export function getSqlClient(): SQL {
  if (!client) {
    const config = getDatabaseConfig()
    log.info('Initializing PostgreSQL connection', {
      url: config.url.replace(/:[^:@]+@/, ':***@'), // Mask password in logs
    })

    client = new SQL(config.url)
    isConnected = true
  }
  return client
}

/**
 * Get the Drizzle database instance
 * Creates a new connection if one doesn't exist
 */
export function getDatabase() {
  if (!db) {
    const sqlClient = getSqlClient()
    db = drizzle(sqlClient, { schema })
    log.info('Drizzle ORM initialized')
  }
  return db
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return isConnected && client !== null
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (client) {
    log.info('Closing PostgreSQL connection')
    await client.close()
    client = null
    db = null
    isConnected = false
  }
}

/**
 * Execute a transaction with automatic rollback on error
 */
export async function transaction<T>(
  fn: (tx: ReturnType<typeof getDatabase>) => Promise<T>
): Promise<T> {
  const database = getDatabase()

  return database.transaction(async (tx) => {
    return fn(tx as unknown as ReturnType<typeof getDatabase>)
  })
}

/**
 * Initialize the database schema
 * Should be called on application startup
 */
export async function initializeDatabase(): Promise<void> {
  const sqlClient = getSqlClient()

  log.info('Checking database connection...')

  try {
    // Simple connectivity test
    const result = await sqlClient`SELECT 1 as connected`
    if (result[0]?.connected === 1) {
      log.info('Database connection established')
    }

    // Check if schema is initialized by looking for sessions table
    const tables = await sqlClient`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'sessions'
    `

    if (tables.length === 0) {
      log.warn('Database schema not initialized. Please run: bun run db:migrate')
    } else {
      log.info('Database schema is initialized')
    }

    // Initialize Drizzle
    getDatabase()
  } catch (error) {
    log.error('Failed to connect to database', { error })
    throw error
  }
}

/**
 * Health check for the database connection
 */
export async function healthCheck(): Promise<{
  healthy: boolean
  latencyMs: number
  error?: string
}> {
  const start = performance.now()

  try {
    const sqlClient = getSqlClient()
    await sqlClient`SELECT 1`
    const latencyMs = performance.now() - start

    return { healthy: true, latencyMs }
  } catch (error) {
    const latencyMs = performance.now() - start
    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Re-export schema for convenience
export { schema }

// Export type for the database instance
export type Database = ReturnType<typeof getDatabase>
