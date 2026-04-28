// server/db/sqlite.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import * as schema from './schema'

export const SQLITE_FILENAME = 'auto-i18n.sqlite'

const GLOBAL_KEY = '__autoI18nSqlite__'
type Sqlite = Database.Database
type GlobalState = {
  sqlite: Sqlite | null
  drizzleDb: ReturnType<typeof drizzle<typeof schema>> | null
}
const g = globalThis as any
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = { sqlite: null, drizzleDb: null } satisfies GlobalState
}
const state: GlobalState = g[GLOBAL_KEY]

function getDbPath(): string {
  return resolve(process.cwd(), 'tmp', SQLITE_FILENAME)
}

export function startSqlite(): void {
  if (state.sqlite) return
  const dbPath = getDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  state.sqlite = sqlite
  console.log(`[sqlite] opened ${dbPath}`)
}

export function stopSqlite(): void {
  if (!state.sqlite) return
  try { state.sqlite.pragma('wal_checkpoint(TRUNCATE)') } catch {}
  try { state.sqlite.close() } catch {}
  state.sqlite = null
  state.drizzleDb = null
}

export function getSqlite(): Sqlite {
  if (!state.sqlite) throw new Error('SQLite not started — call startSqlite() first')
  return state.sqlite
}

export function getDb() {
  if (!state.drizzleDb) {
    state.drizzleDb = drizzle(getSqlite(), { schema })
  }
  return state.drizzleDb
}
