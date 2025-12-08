#!/usr/bin/env bun
/**
 * Database Migration Script
 * Applies the schema.sql to initialize the PostgreSQL database
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SQL } from 'bun'
import { getDatabaseConfig } from '../config/env'

async function runMigration() {
  console.log('🔧 Starting database migration...')
  
  // Get database config
  const config = getDatabaseConfig()
  console.log(`📡 Connecting to database: ${config.url.replace(/:[^:@]+@/, ':***@')}`)
  
  // Create database connection
  const db = new SQL(config.url)
  
  try {
    // Test connection
    const result = await db`SELECT 1 as connected`
    if (result[0]?.connected !== 1) {
      throw new Error('Database connection test failed')
    }
    console.log('✅ Database connection established')
    
    // Read schema file
    const schemaPath = join(import.meta.dir, 'schema.sql')
    const schemaContent = readFileSync(schemaPath, 'utf8')
    console.log(`📄 Read schema from ${schemaPath}`)
    
    // Split schema into individual statements
    // Handle statements that may contain semicolons in function bodies
    const statements = splitSqlStatements(schemaContent)
    
    console.log(`📝 Executing ${statements.length} SQL statements...`)
    
    let successCount = 0
    let skipCount = 0
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim()
      
      if (!statement) continue
      
      try {
        // Use raw query execution for DDL statements
        await db.unsafe(statement)
        successCount++
        
        // Log progress for long migrations
        if ((i + 1) % 10 === 0) {
          console.log(`  Progress: ${i + 1}/${statements.length}`)
        }
      } catch (error: any) {
        // Handle "already exists" errors gracefully
        if (error.message?.includes('already exists') || 
            error.code === '42P07' || // duplicate_table
            error.code === '42710' || // duplicate_object
            error.code === '42723') { // duplicate_function
          skipCount++
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`)
          console.error(`   Statement: ${statement.slice(0, 100)}...`)
          console.error(`   Error: ${error.message}`)
          throw error
        }
      }
    }
    
    console.log('')
    console.log('✅ Migration completed successfully!')
    console.log(`   - Statements executed: ${successCount}`)
    console.log(`   - Statements skipped (already exists): ${skipCount}`)
    
    // Verify tables exist
    const tables = await db`
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
    await db.close()
    console.log('')
    console.log('🔌 Database connection closed')
  }
}

/**
 * Split SQL content into individual statements
 * Handles function bodies that contain semicolons
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inDollarQuote = false
  let dollarTag = ''
  
  const lines = sql.split('\n')
  
  for (const line of lines) {
    // Skip comments
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('--')) {
      continue
    }
    
    // Check for dollar quoting (used in function bodies)
    const dollarMatch = line.match(/\$([a-zA-Z_]*)\$/)
    if (dollarMatch) {
      const tag = dollarMatch[0]
      if (!inDollarQuote) {
        inDollarQuote = true
        dollarTag = tag
      } else if (tag === dollarTag) {
        inDollarQuote = false
        dollarTag = ''
      }
    }
    
    current += line + '\n'
    
    // If we're not in a dollar-quoted block and line ends with semicolon
    if (!inDollarQuote && trimmedLine.endsWith(';')) {
      statements.push(current.trim())
      current = ''
    }
  }
  
  // Add any remaining statement
  if (current.trim()) {
    statements.push(current.trim())
  }
  
  return statements.filter(s => s.length > 0)
}

// Run migration
runMigration()
