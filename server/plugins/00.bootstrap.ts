import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { startSqlite, stopSqlite, getDb } from '../db/sqlite'
import { bootRecover } from '../queue/index'
import { seedDefaultSettings } from '../utils/getSetting'

export default defineNitroPlugin(async (nitroApp) => {
  // Process-wide error handlers
  if (!(process as any).__autoI18nErrorHandlersInstalled) {
    (process as any).__autoI18nErrorHandlersInstalled = true
    process.on('uncaughtException', (err: Error) => {
      console.error('[bootstrap] uncaughtException:', err)
    })
    process.on('unhandledRejection', (reason: any) => {
      console.error('[bootstrap] unhandledRejection:', reason)
    })
  }

  // 1. Open SQLite
  startSqlite()

  // 2. Run migrations
  const db = getDb()
  const migrationsFolder = resolve(process.cwd(), 'server/db/migrations')
  try {
    migrate(db, { migrationsFolder })
    console.log('[db-migrate] schema up to date')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/Can't find meta\/_journal\.json|no such file|ENOENT/i.test(msg)) {
      console.warn('[db-migrate] no migrations found — run `bun run db:generate && bun run db:migrate`')
    } else {
      throw err
    }
  }

  // 3. Seed default settings (prompts + defaults) — only inserts if missing
  await seedDefaultSettings()

  // 4. Recover zombie queue jobs
  await bootRecover().catch((err) => {
    console.error('[queue] bootRecover failed:', err)
  })

  nitroApp.hooks.hookOnce('close', () => {
    stopSqlite()
  })
})
