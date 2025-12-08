/**
 * Session Repository
 * Handles CRUD operations for translation sessions
 * Replaces file-based storage in tmp/<senderId>/
 */
import { getDatabase } from '../database/connection'
import { cacheDel, cacheGet, cacheSet } from '../database/redis'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:session')

// Cache TTL in seconds
const SESSION_CACHE_TTL = 300 // 5 minutes

// ============================================================================
// TYPES
// ============================================================================

export type SessionType = 'upload' | 'changes'
export type SessionStatus = 'active' | 'processing' | 'completed' | 'failed' | 'submitted'

export interface Session {
  id: string
  senderId: string
  sessionType: SessionType
  status: SessionStatus
  
  // Repository information (for changes workflow)
  repositoryOwner?: string
  repositoryName?: string
  baseBranch?: string
  baseCommitSha?: string
  commitSha?: string
  commitMessage?: string
  commitAuthor?: string
  commitTimestamp?: Date
  
  // Locale information
  sourceLocale: string
  targetLocales: string[]
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  
  // Additional metadata
  metadata: Record<string, unknown>
}

export interface CreateSessionInput {
  senderId: string
  sessionType: SessionType
  sourceLocale: string
  targetLocales?: string[]
  repositoryOwner?: string
  repositoryName?: string
  baseBranch?: string
  baseCommitSha?: string
  commitSha?: string
  commitMessage?: string
  commitAuthor?: string
  commitTimestamp?: Date
  expiresAt?: Date
  metadata?: Record<string, unknown>
}

export interface UpdateSessionInput {
  status?: SessionStatus
  targetLocales?: string[]
  repositoryOwner?: string
  repositoryName?: string
  baseBranch?: string
  baseCommitSha?: string
  commitSha?: string
  commitMessage?: string
  commitAuthor?: string
  commitTimestamp?: Date
  expiresAt?: Date
  metadata?: Record<string, unknown>
}

export interface SessionFilter {
  sessionType?: SessionType
  status?: SessionStatus
  repositoryOwner?: string
  repositoryName?: string
  limit?: number
  offset?: number
}

// ============================================================================
// MAPPER
// ============================================================================

function mapRowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    senderId: row.sender_id as string,
    sessionType: row.session_type as SessionType,
    status: row.status as SessionStatus,
    repositoryOwner: row.repository_owner as string | undefined,
    repositoryName: row.repository_name as string | undefined,
    baseBranch: row.base_branch as string | undefined,
    baseCommitSha: row.base_commit_sha as string | undefined,
    commitSha: row.commit_sha as string | undefined,
    commitMessage: row.commit_message as string | undefined,
    commitAuthor: row.commit_author as string | undefined,
    commitTimestamp: row.commit_timestamp ? new Date(row.commit_timestamp as string) : undefined,
    sourceLocale: row.source_locale as string,
    targetLocales: (row.target_locales as string[]) || [],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    metadata: (row.metadata as Record<string, unknown>) || {},
  }
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

function sessionCacheKey(senderId: string): string {
  return `session:${senderId}`
}

async function invalidateSessionCache(senderId: string): Promise<void> {
  await cacheDel(sessionCacheKey(senderId))
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

/**
 * Create a new session
 */
export async function createSession(input: CreateSessionInput): Promise<Session> {
  const db = getDatabase()
  
  const rows = await db`
    INSERT INTO sessions (
      sender_id,
      session_type,
      status,
      source_locale,
      target_locales,
      repository_owner,
      repository_name,
      base_branch,
      base_commit_sha,
      commit_sha,
      commit_message,
      commit_author,
      commit_timestamp,
      expires_at,
      metadata
    ) VALUES (
      ${input.senderId},
      ${input.sessionType},
      'active',
      ${input.sourceLocale},
      ${input.targetLocales || []},
      ${input.repositoryOwner || null},
      ${input.repositoryName || null},
      ${input.baseBranch || null},
      ${input.baseCommitSha || null},
      ${input.commitSha || null},
      ${input.commitMessage || null},
      ${input.commitAuthor || null},
      ${input.commitTimestamp || null},
      ${input.expiresAt || null},
      ${JSON.stringify(input.metadata || {})}
    )
    RETURNING *
  `
  
  const session = mapRowToSession(rows[0])
  log.info('Created session', { senderId: session.senderId, type: session.sessionType })
  
  return session
}

/**
 * Get a session by sender ID
 */
export async function getSessionBySenderId(senderId: string): Promise<Session | null> {
  // Check cache first
  const cached = await cacheGet<Session>(sessionCacheKey(senderId), true)
  if (cached) {
    return cached
  }
  
  const db = getDatabase()
  const rows = await db`
    SELECT * FROM sessions WHERE sender_id = ${senderId}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const session = mapRowToSession(rows[0])
  
  // Cache the result
  await cacheSet(sessionCacheKey(senderId), session, SESSION_CACHE_TTL)
  
  return session
}

/**
 * Get a session by ID
 */
export async function getSessionById(id: string): Promise<Session | null> {
  const db = getDatabase()
  const rows = await db`
    SELECT * FROM sessions WHERE id = ${id}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToSession(rows[0])
}

/**
 * Update a session
 */
export async function updateSession(senderId: string, input: UpdateSessionInput): Promise<Session | null> {
  const db = getDatabase()
  
  // Build dynamic update query
  const updates: string[] = []
  const values: unknown[] = []
  
  if (input.status !== undefined) {
    values.push(input.status)
    updates.push(`status = $${values.length}`)
  }
  if (input.targetLocales !== undefined) {
    values.push(input.targetLocales)
    updates.push(`target_locales = $${values.length}`)
  }
  if (input.repositoryOwner !== undefined) {
    values.push(input.repositoryOwner)
    updates.push(`repository_owner = $${values.length}`)
  }
  if (input.repositoryName !== undefined) {
    values.push(input.repositoryName)
    updates.push(`repository_name = $${values.length}`)
  }
  if (input.baseBranch !== undefined) {
    values.push(input.baseBranch)
    updates.push(`base_branch = $${values.length}`)
  }
  if (input.baseCommitSha !== undefined) {
    values.push(input.baseCommitSha)
    updates.push(`base_commit_sha = $${values.length}`)
  }
  if (input.commitSha !== undefined) {
    values.push(input.commitSha)
    updates.push(`commit_sha = $${values.length}`)
  }
  if (input.commitMessage !== undefined) {
    values.push(input.commitMessage)
    updates.push(`commit_message = $${values.length}`)
  }
  if (input.commitAuthor !== undefined) {
    values.push(input.commitAuthor)
    updates.push(`commit_author = $${values.length}`)
  }
  if (input.commitTimestamp !== undefined) {
    values.push(input.commitTimestamp)
    updates.push(`commit_timestamp = $${values.length}`)
  }
  if (input.expiresAt !== undefined) {
    values.push(input.expiresAt)
    updates.push(`expires_at = $${values.length}`)
  }
  if (input.metadata !== undefined) {
    values.push(JSON.stringify(input.metadata))
    updates.push(`metadata = $${values.length}`)
  }
  
  if (updates.length === 0) {
    return getSessionBySenderId(senderId)
  }
  
  // Use tagged template for the update
  const rows = await db`
    UPDATE sessions 
    SET 
      status = COALESCE(${input.status || null}, status),
      target_locales = COALESCE(${input.targetLocales || null}, target_locales),
      repository_owner = COALESCE(${input.repositoryOwner || null}, repository_owner),
      repository_name = COALESCE(${input.repositoryName || null}, repository_name),
      base_branch = COALESCE(${input.baseBranch || null}, base_branch),
      base_commit_sha = COALESCE(${input.baseCommitSha || null}, base_commit_sha),
      commit_sha = COALESCE(${input.commitSha || null}, commit_sha),
      commit_message = COALESCE(${input.commitMessage || null}, commit_message),
      commit_author = COALESCE(${input.commitAuthor || null}, commit_author),
      commit_timestamp = COALESCE(${input.commitTimestamp || null}, commit_timestamp),
      expires_at = COALESCE(${input.expiresAt || null}, expires_at),
      metadata = COALESCE(${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb, metadata)
    WHERE sender_id = ${senderId}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const session = mapRowToSession(rows[0])
  
  // Invalidate cache
  await invalidateSessionCache(senderId)
  
  log.debug('Updated session', { senderId, updates: Object.keys(input) })
  
  return session
}

/**
 * Delete a session by sender ID
 */
export async function deleteSession(senderId: string): Promise<boolean> {
  const db = getDatabase()
  
  const result = await db`
    DELETE FROM sessions WHERE sender_id = ${senderId}
    RETURNING id
  `
  
  if (result.length > 0) {
    await invalidateSessionCache(senderId)
    log.info('Deleted session', { senderId })
    return true
  }
  
  return false
}

/**
 * List sessions with optional filtering
 */
export async function listSessions(filter: SessionFilter = {}): Promise<Session[]> {
  const db = getDatabase()
  const limit = filter.limit || 50
  const offset = filter.offset || 0
  
  let rows: Record<string, unknown>[]
  
  if (filter.sessionType && filter.status) {
    rows = await db`
      SELECT * FROM sessions 
      WHERE session_type = ${filter.sessionType}
      AND status = ${filter.status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionType) {
    rows = await db`
      SELECT * FROM sessions 
      WHERE session_type = ${filter.sessionType}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.status) {
    rows = await db`
      SELECT * FROM sessions 
      WHERE status = ${filter.status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.repositoryOwner && filter.repositoryName) {
    rows = await db`
      SELECT * FROM sessions 
      WHERE repository_owner = ${filter.repositoryOwner}
      AND repository_name = ${filter.repositoryName}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await db`
      SELECT * FROM sessions 
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  
  return rows.map(mapRowToSession)
}

/**
 * Count sessions with optional filtering
 */
export async function countSessions(filter: SessionFilter = {}): Promise<number> {
  const db = getDatabase()
  
  let result: { count: string }[]
  
  if (filter.sessionType && filter.status) {
    result = await db`
      SELECT COUNT(*) as count FROM sessions 
      WHERE session_type = ${filter.sessionType}
      AND status = ${filter.status}
    `
  } else if (filter.sessionType) {
    result = await db`
      SELECT COUNT(*) as count FROM sessions 
      WHERE session_type = ${filter.sessionType}
    `
  } else if (filter.status) {
    result = await db`
      SELECT COUNT(*) as count FROM sessions 
      WHERE status = ${filter.status}
    `
  } else {
    result = await db`SELECT COUNT(*) as count FROM sessions`
  }
  
  return parseInt(result[0].count, 10)
}

/**
 * Get or create a session by sender ID
 * Useful for upsert operations
 */
export async function getOrCreateSession(input: CreateSessionInput): Promise<{ session: Session; created: boolean }> {
  const existing = await getSessionBySenderId(input.senderId)
  
  if (existing) {
    return { session: existing, created: false }
  }
  
  const session = await createSession(input)
  return { session, created: true }
}

/**
 * Update session status
 */
export async function updateSessionStatus(senderId: string, status: SessionStatus): Promise<Session | null> {
  return updateSession(senderId, { status })
}

/**
 * Add target locales to a session
 */
export async function addTargetLocales(senderId: string, locales: string[]): Promise<Session | null> {
  const db = getDatabase()
  
  const rows = await db`
    UPDATE sessions 
    SET target_locales = array_cat(target_locales, ${locales}::text[])
    WHERE sender_id = ${senderId}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const session = mapRowToSession(rows[0])
  await invalidateSessionCache(senderId)
  
  return session
}

/**
 * Get sessions ready for GitHub finalization
 * (completed translations with no PR created yet)
 */
export async function getSessionsReadyForGitHub(): Promise<Session[]> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT s.* FROM sessions s
    LEFT JOIN translation_jobs tj ON s.id = tj.session_id
    WHERE s.status = 'completed'
    AND (tj.github_pr_number IS NULL OR tj.id IS NULL)
    ORDER BY s.created_at DESC
  `
  
  return rows.map(mapRowToSession)
}

/**
 * Cleanup expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDatabase()
  
  const result = await db`
    DELETE FROM sessions 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW()
    RETURNING id
  `
  
  if (result.length > 0) {
    log.info('Cleaned up expired sessions', { count: result.length })
  }
  
  return result.length
}
