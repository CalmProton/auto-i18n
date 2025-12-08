/**
 * Session Repository
 * Handles CRUD operations for translation sessions using Drizzle ORM
 */
import { eq, and, desc, lt, sql, isNull } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { sessions, translationJobs } from '../database/schema'
import type { Session, NewSession, SessionStatus, SessionType } from '../database/schema'
import { cacheDel, cacheGet, cacheSet } from '../database/redis'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:session')

// Cache TTL in seconds
const SESSION_CACHE_TTL = 300 // 5 minutes

// ============================================================================
// TYPES
// ============================================================================

export type { Session, SessionType, SessionStatus }

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

  const [session] = await db
    .insert(sessions)
    .values({
      senderId: input.senderId,
      sessionType: input.sessionType,
      status: 'active',
      sourceLocale: input.sourceLocale,
      targetLocales: input.targetLocales || [],
      repositoryOwner: input.repositoryOwner,
      repositoryName: input.repositoryName,
      baseBranch: input.baseBranch,
      baseCommitSha: input.baseCommitSha,
      commitSha: input.commitSha,
      commitMessage: input.commitMessage,
      commitAuthor: input.commitAuthor,
      commitTimestamp: input.commitTimestamp,
      expiresAt: input.expiresAt,
      metadata: input.metadata || {},
    })
    .returning()

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
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.senderId, senderId))
    .limit(1)

  if (!session) {
    return null
  }

  // Cache the result
  await cacheSet(sessionCacheKey(senderId), session, SESSION_CACHE_TTL)

  return session
}

/**
 * Get a session by ID
 */
export async function getSessionById(id: string): Promise<Session | null> {
  const db = getDatabase()
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  return session || null
}

/**
 * Update a session
 */
export async function updateSession(
  senderId: string,
  input: UpdateSessionInput
): Promise<Session | null> {
  // Check if there's anything to update
  const hasUpdates = Object.keys(input).length > 0
  if (!hasUpdates) {
    return getSessionBySenderId(senderId)
  }

  const db = getDatabase()

  // Build update object with only defined fields
  const updateData: Partial<NewSession> = {}
  if (input.status !== undefined) updateData.status = input.status
  if (input.targetLocales !== undefined) updateData.targetLocales = input.targetLocales
  if (input.repositoryOwner !== undefined) updateData.repositoryOwner = input.repositoryOwner
  if (input.repositoryName !== undefined) updateData.repositoryName = input.repositoryName
  if (input.baseBranch !== undefined) updateData.baseBranch = input.baseBranch
  if (input.baseCommitSha !== undefined) updateData.baseCommitSha = input.baseCommitSha
  if (input.commitSha !== undefined) updateData.commitSha = input.commitSha
  if (input.commitMessage !== undefined) updateData.commitMessage = input.commitMessage
  if (input.commitAuthor !== undefined) updateData.commitAuthor = input.commitAuthor
  if (input.commitTimestamp !== undefined) updateData.commitTimestamp = input.commitTimestamp
  if (input.expiresAt !== undefined) updateData.expiresAt = input.expiresAt
  if (input.metadata !== undefined) updateData.metadata = input.metadata

  const [session] = await db
    .update(sessions)
    .set(updateData)
    .where(eq(sessions.senderId, senderId))
    .returning()

  if (!session) {
    return null
  }

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

  const result = await db
    .delete(sessions)
    .where(eq(sessions.senderId, senderId))
    .returning({ id: sessions.id })

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

  let query = db.select().from(sessions)

  const conditions = []
  if (filter.sessionType) {
    conditions.push(eq(sessions.sessionType, filter.sessionType))
  }
  if (filter.status) {
    conditions.push(eq(sessions.status, filter.status))
  }
  if (filter.repositoryOwner && filter.repositoryName) {
    conditions.push(eq(sessions.repositoryOwner, filter.repositoryOwner))
    conditions.push(eq(sessions.repositoryName, filter.repositoryName))
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  return query.orderBy(desc(sessions.createdAt)).limit(limit).offset(offset)
}

/**
 * Count sessions with optional filtering
 */
export async function countSessions(filter: SessionFilter = {}): Promise<number> {
  const db = getDatabase()

  const conditions = []
  if (filter.sessionType) {
    conditions.push(eq(sessions.sessionType, filter.sessionType))
  }
  if (filter.status) {
    conditions.push(eq(sessions.status, filter.status))
  }

  let query = db.select({ count: sql<number>`count(*)` }).from(sessions)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  const [result] = await query

  return Number(result?.count || 0)
}

/**
 * Get or create a session by sender ID
 */
export async function getOrCreateSession(
  input: CreateSessionInput
): Promise<{ session: Session; created: boolean }> {
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
export async function updateSessionStatus(
  senderId: string,
  status: SessionStatus
): Promise<Session | null> {
  return updateSession(senderId, { status })
}

/**
 * Add target locales to a session
 */
export async function addTargetLocales(
  senderId: string,
  locales: string[]
): Promise<Session | null> {
  const db = getDatabase()

  const [session] = await db
    .update(sessions)
    .set({
      targetLocales: sql`array_cat(${sessions.targetLocales}, ${locales}::text[])`,
    })
    .where(eq(sessions.senderId, senderId))
    .returning()

  if (!session) {
    return null
  }

  await invalidateSessionCache(senderId)

  return session
}

/**
 * Get sessions ready for GitHub finalization
 * (completed translations with no PR created yet)
 */
export async function getSessionsReadyForGitHub(): Promise<Session[]> {
  const db = getDatabase()

  // Using a left join to find sessions without PRs
  const result = await db
    .select({
      session: sessions,
    })
    .from(sessions)
    .leftJoin(translationJobs, eq(sessions.id, translationJobs.sessionId))
    .where(
      and(
        eq(sessions.status, 'completed'),
        isNull(translationJobs.githubPrNumber)
      )
    )
    .orderBy(desc(sessions.createdAt))

  // Extract unique sessions
  const sessionMap = new Map<string, Session>()
  for (const row of result) {
    if (!sessionMap.has(row.session.id)) {
      sessionMap.set(row.session.id, row.session)
    }
  }

  return Array.from(sessionMap.values())
}

/**
 * Cleanup expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDatabase()

  const result = await db
    .delete(sessions)
    .where(
      and(
        sql`${sessions.expiresAt} IS NOT NULL`,
        lt(sessions.expiresAt, new Date())
      )
    )
    .returning({ id: sessions.id })

  if (result.length > 0) {
    log.info('Cleaned up expired sessions', { count: result.length })
  }

  return result.length
}
