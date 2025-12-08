/**
 * PostgreSQL connection module using Bun's native SQL client
 */
import { SQL } from 'bun'
import { getDatabaseConfig } from '../config/env'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('database:connection')

let db: SQL | null = null
let isConnected = false

/**
 * Get the database connection instance
 * Creates a new connection if one doesn't exist
 */
export function getDatabase(): SQL {
  if (!db) {
    const config = getDatabaseConfig()
    log.info('Initializing PostgreSQL connection', { 
      url: config.url.replace(/:[^:@]+@/, ':***@') // Mask password in logs
    })
    
    db = new SQL(config.url)
    isConnected = true
  }
  return db
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return isConnected && db !== null
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    log.info('Closing PostgreSQL connection')
    await db.close()
    db = null
    isConnected = false
  }
}

/**
 * Execute a raw SQL query using tagged template literals
 * This is a convenience wrapper around the database connection
 */
export async function query<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const database = getDatabase()
  return database(strings, ...values) as Promise<T[]>
}

/**
 * Execute a transaction with automatic rollback on error
 */
export async function transaction<T>(
  fn: (sql: SQL) => Promise<T>
): Promise<T> {
  const database = getDatabase()
  
  try {
    await database`BEGIN`
    const result = await fn(database)
    await database`COMMIT`
    return result
  } catch (error) {
    await database`ROLLBACK`
    log.error('Transaction failed, rolled back', { error })
    throw error
  }
}

/**
 * Initialize the database schema
 * Should be called on application startup
 */
export async function initializeDatabase(): Promise<void> {
  const database = getDatabase()
  
  log.info('Checking database connection...')
  
  try {
    // Simple connectivity test
    const result = await database`SELECT 1 as connected`
    if (result[0]?.connected === 1) {
      log.info('Database connection established')
    }
    
    // Check if schema is initialized by looking for sessions table
    const tables = await database`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'sessions'
    `
    
    if (tables.length === 0) {
      log.warn('Database schema not initialized. Please run the schema.sql migration.')
    } else {
      log.info('Database schema is initialized')
    }
  } catch (error) {
    log.error('Failed to connect to database', { error })
    throw error
  }
}

/**
 * Health check for the database connection
 */
export async function healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = performance.now()
  
  try {
    const database = getDatabase()
    await database`SELECT 1`
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

// Export the SQL type for use in repositories
export { SQL }
