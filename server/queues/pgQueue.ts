/**
 * PostgreSQL-based Job Queue
 * 
 * Implements a pg-boss style queue using SKIP LOCKED for safe concurrent job processing.
 *
 */
import { eq, and, lte, sql, desc, isNull } from 'drizzle-orm'
import { getDatabase, getSqlClient } from '../database/connection'
import { jobQueue, type JobQueueName, type JobQueueStatus, type JobQueueItem } from '../database/schema'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('queue:pg')

// Worker ID for this instance (for debugging)
const WORKER_ID = `worker-${process.pid}-${Date.now()}`

// ============================================================================
// JOB DATA TYPES
// ============================================================================

export interface BatchPollJobData {
  batchId: string
  senderId: string
  openaiBatchId: string
  attempt?: number
}

export interface BatchProcessJobData {
  batchId: string
  senderId: string
}

export interface GitHubFinalizeJobData {
  senderId: string
  sessionId: string
  dryRun?: boolean
}

export interface CleanupJobData {
  type: 'expired-sessions' | 'old-batches' | 'old-jobs'
  olderThanDays?: number
}

export interface StatsUpdateJobData {
  sessionId?: string
  recalculateAll?: boolean
}

// Union type for all job data
export type JobData = 
  | BatchPollJobData 
  | BatchProcessJobData 
  | GitHubFinalizeJobData 
  | CleanupJobData 
  | StatsUpdateJobData

// ============================================================================
// JOB CREATION
// ============================================================================

export interface AddJobOptions {
  delay?: number // Delay in milliseconds before job runs
  maxAttempts?: number
  expiresIn?: number // Time in milliseconds until completed job expires
}

/**
 * Add a job to the queue
 */
export async function addJob(
  name: JobQueueName,
  data: JobData,
  options: AddJobOptions = {}
): Promise<string> {
  const db = getDatabase()
  
  const runAt = options.delay 
    ? new Date(Date.now() + options.delay)
    : new Date()
  
  const expiresAt = options.expiresIn
    ? new Date(Date.now() + options.expiresIn)
    : null
  
  const [job] = await db
    .insert(jobQueue)
    .values({
      name,
      data: data as Record<string, unknown>,
      runAt,
      maxAttempts: options.maxAttempts ?? 3,
      expiresAt,
    })
    .returning({ id: jobQueue.id })
  
  log.debug('Added job', { name, jobId: job.id, runAt })
  
  return job.id
}

// ============================================================================
// CONVENIENCE METHODS FOR SPECIFIC JOB TYPES
// ============================================================================

export async function addBatchPollJob(
  data: BatchPollJobData, 
  options?: AddJobOptions
): Promise<string> {
  return addJob('batch-poll', data, options)
}

export async function addBatchProcessJob(
  data: BatchProcessJobData, 
  options?: AddJobOptions
): Promise<string> {
  return addJob('batch-process', data, options)
}

export async function addGitHubFinalizeJob(
  data: GitHubFinalizeJobData, 
  options?: AddJobOptions
): Promise<string> {
  return addJob('github-finalize', data, options)
}

export async function addCleanupJob(
  data: CleanupJobData, 
  options?: AddJobOptions
): Promise<string> {
  return addJob('cleanup', data, options)
}

export async function addStatsUpdateJob(
  data: StatsUpdateJobData, 
  options?: AddJobOptions
): Promise<string> {
  return addJob('stats-update', data, options)
}

// ============================================================================
// JOB CLAIMING AND PROCESSING
// ============================================================================

/**
 * Claim a job for processing using SELECT FOR UPDATE SKIP LOCKED
 * This ensures safe concurrent processing across multiple workers
 */
export async function claimJob(name: JobQueueName): Promise<JobQueueItem | null> {
  const sqlClient = getSqlClient()
  
  // Use raw SQL for SKIP LOCKED which Drizzle doesn't support directly
  const result = await sqlClient`
    UPDATE job_queue
    SET 
      status = 'running',
      started_at = NOW(),
      worker_id = ${WORKER_ID},
      attempts = attempts + 1,
      updated_at = NOW()
    WHERE id = (
      SELECT id FROM job_queue
      WHERE name = ${name}
        AND status = 'pending'
        AND run_at <= NOW()
        AND attempts < max_attempts
      ORDER BY run_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `
  
  if (result.length === 0) {
    return null
  }
  
  const row = result[0]
  return {
    id: row.id,
    name: row.name as JobQueueName,
    status: row.status as JobQueueStatus,
    data: row.data as Record<string, unknown>,
    runAt: row.run_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    result: row.result as Record<string, unknown> | null,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    workerId: row.worker_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

/**
 * Mark a job as completed
 */
export async function completeJob(
  jobId: string, 
  result?: Record<string, unknown>
): Promise<void> {
  const db = getDatabase()
  
  await db
    .update(jobQueue)
    .set({
      status: 'completed',
      completedAt: new Date(),
      result: result ?? null,
      updatedAt: new Date(),
    })
    .where(eq(jobQueue.id, jobId))
  
  log.debug('Job completed', { jobId })
}

/**
 * Mark a job as failed
 */
export async function failJob(
  jobId: string,
  error: Error | string
): Promise<void> {
  const db = getDatabase()
  
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined
  
  await db
    .update(jobQueue)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage,
      errorStack,
      updatedAt: new Date(),
    })
    .where(eq(jobQueue.id, jobId))
  
  log.debug('Job failed', { jobId, errorMessage })
}

/**
 * Reschedule a failed job for retry
 */
export async function retryJob(
  jobId: string,
  delayMs: number = 30000
): Promise<void> {
  const db = getDatabase()
  
  await db
    .update(jobQueue)
    .set({
      status: 'pending',
      runAt: new Date(Date.now() + delayMs),
      startedAt: null,
      workerId: null,
      updatedAt: new Date(),
    })
    .where(eq(jobQueue.id, jobId))
  
  log.debug('Job rescheduled for retry', { jobId, delayMs })
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

/**
 * Get queue statistics
 */
export async function getQueueStats(name?: JobQueueName): Promise<{
  pending: number
  running: number
  completed: number
  failed: number
}> {
  const sqlClient = getSqlClient()
  
  const whereClause = name ? sql`WHERE name = ${name}` : sql``
  
  const result = await sqlClient`
    SELECT 
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM job_queue
    ${whereClause}
  `
  
  return {
    pending: Number(result[0].pending),
    running: Number(result[0].running),
    completed: Number(result[0].completed),
    failed: Number(result[0].failed),
  }
}

/**
 * Get all queue statistics by name
 */
export async function getAllQueueStats(): Promise<Record<JobQueueName, {
  pending: number
  running: number
  completed: number
  failed: number
}>> {
  const sqlClient = getSqlClient()
  
  const result = await sqlClient`
    SELECT 
      name,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM job_queue
    GROUP BY name
  `
  
  const stats: Record<string, { pending: number; running: number; completed: number; failed: number }> = {}
  
  for (const row of result) {
    stats[row.name] = {
      pending: Number(row.pending),
      running: Number(row.running),
      completed: Number(row.completed),
      failed: Number(row.failed),
    }
  }
  
  return stats as Record<JobQueueName, { pending: number; running: number; completed: number; failed: number }>
}

/**
 * Clean up old completed/failed jobs
 */
export async function cleanOldJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDatabase()
  
  const cutoff = new Date(Date.now() - olderThanMs)
  
  const result = await db
    .delete(jobQueue)
    .where(
      and(
        sql`${jobQueue.status} IN ('completed', 'failed')`,
        lte(jobQueue.completedAt, cutoff)
      )
    )
    .returning({ id: jobQueue.id })
  
  log.info('Cleaned old jobs', { count: result.length })
  
  return result.length
}

/**
 * Reset stale running jobs (jobs that have been running for too long)
 * This handles workers that crashed without completing their jobs
 */
export async function resetStaleJobs(staleAfterMs: number = 5 * 60 * 1000): Promise<number> {
  const db = getDatabase()
  
  const cutoff = new Date(Date.now() - staleAfterMs)
  
  const result = await db
    .update(jobQueue)
    .set({
      status: 'pending',
      startedAt: null,
      workerId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobQueue.status, 'running'),
        lte(jobQueue.startedAt, cutoff)
      )
    )
    .returning({ id: jobQueue.id })
  
  if (result.length > 0) {
    log.warn('Reset stale jobs', { count: result.length })
  }
  
  return result.length
}

/**
 * Cancel a pending job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const db = getDatabase()
  
  const result = await db
    .update(jobQueue)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobQueue.id, jobId),
        eq(jobQueue.status, 'pending')
      )
    )
    .returning({ id: jobQueue.id })
  
  return result.length > 0
}

/**
 * Cancel all pending jobs for a specific sender
 */
export async function cancelJobsBySenderId(senderId: string): Promise<number> {
  const db = getDatabase()
  
  // Use sql fragment for JSONB containment check
  // data @> '{"senderId": "..."}'
  const result = await db
    .update(jobQueue)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobQueue.status, 'pending'),
        sql`${jobQueue.data} @> ${JSON.stringify({ senderId })}::jsonb`
      )
    )
    .returning({ id: jobQueue.id })
  
  if (result.length > 0) {
    log.info('Cancelled jobs for sender', { senderId, count: result.length })
  }
  
  return result.length
}

/**
 * Get pending jobs for a specific queue
 */
export async function getPendingJobs(
  name: JobQueueName,
  limit: number = 10
): Promise<JobQueueItem[]> {
  const db = getDatabase()
  
  return db
    .select()
    .from(jobQueue)
    .where(
      and(
        eq(jobQueue.name, name),
        eq(jobQueue.status, 'pending')
      )
    )
    .orderBy(jobQueue.runAt)
    .limit(limit)
}

/**
 * Schedule a recurring cleanup job
 */
export async function scheduleCleanupJob(): Promise<void> {
  // Check if there's already a pending cleanup job
  const db = getDatabase()
  
  const existing = await db
    .select()
    .from(jobQueue)
    .where(
      and(
        eq(jobQueue.name, 'cleanup'),
        eq(jobQueue.status, 'pending')
      )
    )
    .limit(1)
  
  if (existing.length === 0) {
    await addCleanupJob({ type: 'old-jobs' }, { delay: 60 * 60 * 1000 }) // 1 hour
    log.info('Scheduled cleanup job')
  }
}
