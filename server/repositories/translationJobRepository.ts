/**
 * Translation Job Repository
 * Handles CRUD operations for translation jobs within sessions
 * Replaces file-based storage in metadata.json jobs array
 */
import { getDatabase } from '../database/connection'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:translation-job')

// ============================================================================
// TYPES
// ============================================================================

export type JobType = 'content' | 'global' | 'page'

export interface TranslationJob {
  id: string
  sessionId: string
  jobId: string
  jobType?: JobType
  
  // Translation details
  sourceLocale: string
  targetLocales: string[]
  
  // GitHub integration
  githubIssueNumber?: number
  githubIssueUrl?: string
  githubPrNumber?: number
  githubPrUrl?: string
  githubBranch?: string
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}

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
// MAPPER
// ============================================================================

function mapRowToJob(row: Record<string, unknown>): TranslationJob {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    jobId: row.job_id as string,
    jobType: row.job_type as JobType | undefined,
    sourceLocale: row.source_locale as string,
    targetLocales: (row.target_locales as string[]) || [],
    githubIssueNumber: row.github_issue_number as number | undefined,
    githubIssueUrl: row.github_issue_url as string | undefined,
    githubPrNumber: row.github_pr_number as number | undefined,
    githubPrUrl: row.github_pr_url as string | undefined,
    githubBranch: row.github_branch as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

/**
 * Create a new translation job
 */
export async function createTranslationJob(input: CreateTranslationJobInput): Promise<TranslationJob> {
  const db = getDatabase()
  
  const rows = await db`
    INSERT INTO translation_jobs (
      session_id,
      job_id,
      job_type,
      source_locale,
      target_locales
    ) VALUES (
      ${input.sessionId},
      ${input.jobId},
      ${input.jobType || null},
      ${input.sourceLocale},
      ${input.targetLocales || []}
    )
    RETURNING *
  `
  
  const job = mapRowToJob(rows[0])
  log.debug('Created translation job', { sessionId: job.sessionId, jobId: job.jobId })
  
  return job
}

/**
 * Get a translation job by session ID and job ID
 */
export async function getTranslationJob(sessionId: string, jobId: string): Promise<TranslationJob | null> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT * FROM translation_jobs 
    WHERE session_id = ${sessionId}
    AND job_id = ${jobId}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToJob(rows[0])
}

/**
 * Get a translation job by ID
 */
export async function getTranslationJobById(id: string): Promise<TranslationJob | null> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT * FROM translation_jobs WHERE id = ${id}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToJob(rows[0])
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
  
  const rows = await db`
    UPDATE translation_jobs 
    SET 
      target_locales = COALESCE(${input.targetLocales || null}, target_locales),
      github_issue_number = COALESCE(${input.githubIssueNumber ?? null}, github_issue_number),
      github_issue_url = COALESCE(${input.githubIssueUrl || null}, github_issue_url),
      github_pr_number = COALESCE(${input.githubPrNumber ?? null}, github_pr_number),
      github_pr_url = COALESCE(${input.githubPrUrl || null}, github_pr_url),
      github_branch = COALESCE(${input.githubBranch || null}, github_branch)
    WHERE session_id = ${sessionId}
    AND job_id = ${jobId}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const job = mapRowToJob(rows[0])
  log.debug('Updated translation job', { sessionId, jobId, updates: Object.keys(input) })
  
  return job
}

/**
 * Delete a translation job
 */
export async function deleteTranslationJob(sessionId: string, jobId: string): Promise<boolean> {
  const db = getDatabase()
  
  const result = await db`
    DELETE FROM translation_jobs 
    WHERE session_id = ${sessionId}
    AND job_id = ${jobId}
    RETURNING id
  `
  
  return result.length > 0
}

/**
 * List translation jobs with filtering
 */
export async function listTranslationJobs(filter: TranslationJobFilter = {}): Promise<TranslationJob[]> {
  const db = getDatabase()
  const limit = filter.limit || 50
  const offset = filter.offset || 0
  
  let rows: Record<string, unknown>[]
  
  if (filter.sessionId && filter.hasPr === true) {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE session_id = ${filter.sessionId}
      AND github_pr_number IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId && filter.hasPr === false) {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE session_id = ${filter.sessionId}
      AND github_pr_number IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId) {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE session_id = ${filter.sessionId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.jobType) {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE job_type = ${filter.jobType}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await db`
      SELECT * FROM translation_jobs 
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  
  return rows.map(mapRowToJob)
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
  
  let rows: Record<string, unknown>[]
  
  if (sessionId) {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE session_id = ${sessionId}
      AND github_pr_number IS NULL
      ORDER BY created_at DESC
    `
  } else {
    rows = await db`
      SELECT * FROM translation_jobs 
      WHERE github_pr_number IS NULL
      ORDER BY created_at DESC
    `
  }
  
  return rows.map(mapRowToJob)
}

/**
 * Count translation jobs
 */
export async function countTranslationJobs(filter: TranslationJobFilter = {}): Promise<number> {
  const db = getDatabase()
  
  let result: { count: string }[]
  
  if (filter.sessionId) {
    result = await db`
      SELECT COUNT(*) as count FROM translation_jobs 
      WHERE session_id = ${filter.sessionId}
    `
  } else {
    result = await db`SELECT COUNT(*) as count FROM translation_jobs`
  }
  
  return parseInt(result[0].count, 10)
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
  
  const rows = await db`
    UPDATE translation_jobs 
    SET target_locales = array_cat(target_locales, ${locales}::text[])
    WHERE session_id = ${sessionId}
    AND job_id = ${jobId}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToJob(rows[0])
}
