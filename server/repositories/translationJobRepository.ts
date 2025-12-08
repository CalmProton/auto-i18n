/**
 * Translation Job Repository
 * Handles CRUD operations for translation jobs within sessions using Drizzle ORM
 */
import { eq, and, desc, sql, isNull } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { translationJobs } from '../database/schema'
import type { TranslationJob, NewTranslationJob, JobType } from '../database/schema'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:translation-job')

// ============================================================================
// TYPES
// ============================================================================

export type { TranslationJob, JobType }

export interface CreateTranslationJobInput {
  sessionId: string
  jobId: string
  jobType?: JobType
  sourceLocale: string
  targetLocales?: string[]
}

export interface UpdateTranslationJobInput {
  targetLocales?: string[]
  githubIssueNumber?: number
  githubIssueUrl?: string
  githubPrNumber?: number
  githubPrUrl?: string
  githubBranch?: string
}

export interface TranslationJobFilter {
  sessionId?: string
  jobType?: JobType
  hasPr?: boolean
  limit?: number
  offset?: number
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

/**
 * Create a new translation job
 */
export async function createTranslationJob(
  input: CreateTranslationJobInput
): Promise<TranslationJob> {
  const db = getDatabase()

  const [job] = await db
    .insert(translationJobs)
    .values({
      sessionId: input.sessionId,
      jobId: input.jobId,
      jobType: input.jobType,
      sourceLocale: input.sourceLocale,
      targetLocales: input.targetLocales || [],
    })
    .returning()

  log.debug('Created translation job', { sessionId: job.sessionId, jobId: job.jobId })

  return job
}

/**
 * Get a translation job by session ID and job ID
 */
export async function getTranslationJob(
  sessionId: string,
  jobId: string
): Promise<TranslationJob | null> {
  const db = getDatabase()

  const [job] = await db
    .select()
    .from(translationJobs)
    .where(and(eq(translationJobs.sessionId, sessionId), eq(translationJobs.jobId, jobId)))
    .limit(1)

  return job || null
}

/**
 * Get a translation job by ID (UUID)
 */
export async function getTranslationJobById(id: string): Promise<TranslationJob | null> {
  const db = getDatabase()

  const [job] = await db.select().from(translationJobs).where(eq(translationJobs.id, id)).limit(1)

  return job || null
}

/**
 * Update a translation job
 */
export async function updateTranslationJob(
  sessionId: string,
  jobId: string,
  input: UpdateTranslationJobInput
): Promise<TranslationJob | null> {
  const db = getDatabase()

  // Build update object with only defined fields
  const updateData: Partial<NewTranslationJob> = {}
  if (input.targetLocales !== undefined) updateData.targetLocales = input.targetLocales
  if (input.githubIssueNumber !== undefined) updateData.githubIssueNumber = input.githubIssueNumber
  if (input.githubIssueUrl !== undefined) updateData.githubIssueUrl = input.githubIssueUrl
  if (input.githubPrNumber !== undefined) updateData.githubPrNumber = input.githubPrNumber
  if (input.githubPrUrl !== undefined) updateData.githubPrUrl = input.githubPrUrl
  if (input.githubBranch !== undefined) updateData.githubBranch = input.githubBranch

  const [job] = await db
    .update(translationJobs)
    .set(updateData)
    .where(and(eq(translationJobs.sessionId, sessionId), eq(translationJobs.jobId, jobId)))
    .returning()

  if (!job) {
    return null
  }

  log.debug('Updated translation job', { sessionId, jobId, updates: Object.keys(input) })

  return job
}

/**
 * Delete a translation job
 */
export async function deleteTranslationJob(sessionId: string, jobId: string): Promise<boolean> {
  const db = getDatabase()

  const result = await db
    .delete(translationJobs)
    .where(and(eq(translationJobs.sessionId, sessionId), eq(translationJobs.jobId, jobId)))
    .returning({ id: translationJobs.id })

  return result.length > 0
}

/**
 * List translation jobs with filtering
 */
export async function listTranslationJobs(
  filter: TranslationJobFilter = {}
): Promise<TranslationJob[]> {
  const db = getDatabase()
  const limit = filter.limit || 50
  const offset = filter.offset || 0

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(translationJobs.sessionId, filter.sessionId))
  }
  if (filter.jobType) {
    conditions.push(eq(translationJobs.jobType, filter.jobType))
  }
  if (filter.hasPr === true) {
    conditions.push(sql`${translationJobs.githubPrNumber} IS NOT NULL`)
  } else if (filter.hasPr === false) {
    conditions.push(isNull(translationJobs.githubPrNumber))
  }

  let query = db.select().from(translationJobs)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  return query.orderBy(desc(translationJobs.createdAt)).limit(limit).offset(offset)
}

/**
 * Get translation jobs for a session
 */
export async function getJobsForSession(sessionId: string): Promise<TranslationJob[]> {
  return listTranslationJobs({ sessionId, limit: 1000 })
}

/**
 * Get or create a translation job
 */
export async function getOrCreateTranslationJob(
  input: CreateTranslationJobInput
): Promise<{ job: TranslationJob; created: boolean }> {
  const existing = await getTranslationJob(input.sessionId, input.jobId)

  if (existing) {
    return { job: existing, created: false }
  }

  const job = await createTranslationJob(input)
  return { job, created: true }
}

/**
 * Update GitHub issue info
 */
export async function updateGitHubIssue(
  sessionId: string,
  jobId: string,
  issueNumber: number,
  issueUrl: string
): Promise<TranslationJob | null> {
  return updateTranslationJob(sessionId, jobId, {
    githubIssueNumber: issueNumber,
    githubIssueUrl: issueUrl,
  })
}

/**
 * Update GitHub PR info
 */
export async function updateGitHubPr(
  sessionId: string,
  jobId: string,
  prNumber: number,
  prUrl: string,
  branch: string
): Promise<TranslationJob | null> {
  return updateTranslationJob(sessionId, jobId, {
    githubPrNumber: prNumber,
    githubPrUrl: prUrl,
    githubBranch: branch,
  })
}

/**
 * Get jobs without PRs (ready for finalization)
 */
export async function getJobsWithoutPr(sessionId?: string): Promise<TranslationJob[]> {
  const db = getDatabase()

  const conditions = [isNull(translationJobs.githubPrNumber)]

  if (sessionId) {
    conditions.push(eq(translationJobs.sessionId, sessionId))
  }

  return db
    .select()
    .from(translationJobs)
    .where(and(...conditions))
    .orderBy(desc(translationJobs.createdAt))
}

/**
 * Count translation jobs
 */
export async function countTranslationJobs(filter: TranslationJobFilter = {}): Promise<number> {
  const db = getDatabase()

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(translationJobs.sessionId, filter.sessionId))
  }

  let query = db.select({ count: sql<number>`count(*)` }).from(translationJobs)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  const [result] = await query

  return Number(result?.count || 0)
}

/**
 * Add target locales to a job
 */
export async function addTargetLocales(
  sessionId: string,
  jobId: string,
  locales: string[]
): Promise<TranslationJob | null> {
  const db = getDatabase()

  const [job] = await db
    .update(translationJobs)
    .set({
      targetLocales: sql`array_cat(${translationJobs.targetLocales}, ${locales}::text[])`,
    })
    .where(and(eq(translationJobs.sessionId, sessionId), eq(translationJobs.jobId, jobId)))
    .returning()

  return job || null
}
