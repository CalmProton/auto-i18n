/**
 * Database module exports
 * Provides unified access to PostgreSQL connection
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

/**
 * Initialize all database connections
 */
export async function initializeAll(): Promise<void> {
  const { initializeDatabase } = await import('./connection')
  await initializeDatabase()
}

/**
 * Close all database connections
 */
export async function closeAll(): Promise<void> {
  const { closeDatabase } = await import('./connection')
  await closeDatabase()
}

/**
 * Health check for database connection
 */
export async function healthCheckAll(): Promise<{
  database: { healthy: boolean; latencyMs: number; error?: string }
  overall: boolean
}> {
  const { healthCheck: dbHealth } = await import('./connection')
  const database = await dbHealth()
  
  return {
    database,
    overall: database.healthy,
  }
}
