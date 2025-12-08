#!/usr/bin/env bun
/**
 * Database Migration Script
 * Uses Drizzle ORM migrations to manage PostgreSQL database schema
 */
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { SQL } from 'bun'
import { getDatabaseConfig } from '../config/env'
import { join } from 'node:path'

async function runMigration() {
  console.log('🔧 Starting database migration with Drizzle...')

  // Get database config
  const config = getDatabaseConfig()
  console.log(`📡 Connecting to database: ${config.url.replace(/:[^:@]+@/, ':***@')}`)

  // Create database connection
  const client = new SQL(config.url)
  const db = drizzle(client)

  try {
    // Test connection
    const result = await client`SELECT 1 as connected`
    if (result[0]?.connected !== 1) {
      throw new Error('Database connection test failed')
    }
    console.log('✅ Database connection established')

    // Run Drizzle migrations
    const migrationsFolder = join(import.meta.dir, 'migrations')
    console.log(`📄 Running migrations from ${migrationsFolder}`)

    await migrate(db, { migrationsFolder })

    console.log('')
    console.log('✅ Migration completed successfully!')

    // Verify tables exist
    const tables = await client`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    console.log('')
    console.log('📊 Database tables:')
    for (const table of tables) {
      console.log(`   - ${table.table_name}`)
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await client.close()
    console.log('')
    console.log('🔌 Database connection closed')
  }
}

runMigration()
