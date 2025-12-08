/**
 * BullMQ Queue Configuration
 * Sets up job queues for translation processing with DragonflyDB
 * 
 * Note: Uses hashtag-based queue names for optimal DragonflyDB performance
 * This ensures queues are properly distributed across threads
 */
import { Queue, Worker, Job, QueueEvents, type ConnectionOptions, type JobsOptions } from 'bullmq'
import { getRedisConfig } from '../config/env'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('queues')

// ============================================================================
// CONNECTION CONFIGURATION
// ============================================================================

let connectionOptions: ConnectionOptions | null = null

/**
 * Get Redis connection options for BullMQ
 * Parses the REDIS_URL and returns connection config
 */
export function getConnectionOptions(): ConnectionOptions {
  if (!connectionOptions) {
    const config = getRedisConfig()
    const url = new URL(config.url)
    
    connectionOptions = {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
    }
    
    log.info('Initialized BullMQ connection options', { 
      host: connectionOptions.host, 
      port: connectionOptions.port 
    })
  }
  
  return connectionOptions
}

// ============================================================================
// QUEUE NAMES (with hashtags for DragonflyDB optimization)
// ============================================================================

/**
 * Queue names use hashtags {} for DragonflyDB thread affinity
 * This ensures related queues are handled by the same Dragonfly thread
 * Note: BullMQ does not allow colons in queue names, so we use hyphens
 */
export const QueueNames = {
  // Translation pipeline queues
  translation: '{translation}',
  translationBatch: '{translation-batch}',
  
  // Batch processing queues
  batchCreate: '{batch}-create',
  batchSubmit: '{batch}-submit',
  batchPoll: '{batch}-poll',
  batchProcess: '{batch}-process',
  
  // GitHub integration queues
  github: '{github}',
  githubFinalize: '{github}-finalize',
  
  // Cleanup and maintenance queues
  cleanup: '{maintenance}-cleanup',
  stats: '{maintenance}-stats',
} as const

export type QueueName = typeof QueueNames[keyof typeof QueueNames]

// ============================================================================
// JOB TYPES
// ============================================================================

// Translation job data
export interface TranslateJobData {
  senderId: string
  sessionId: string
  sourceLocale: string
  targetLocales: string[]
  contentTypes: ('content' | 'global' | 'page')[]
  fileIds?: string[]
}

// Batch create job data
export interface BatchCreateJobData {
  senderId: string
  sessionId: string
  sourceLocale: string
  targetLocales: string[]
  contentTypes: ('content' | 'global' | 'page')[]
  model: string
}

// Batch submit job data
export interface BatchSubmitJobData {
  batchId: string
  senderId: string
}

// Batch poll job data
export interface BatchPollJobData {
  batchId: string
  senderId: string
  openaiBatchId: string
  attempt?: number
}

// Batch process job data
export interface BatchProcessJobData {
  batchId: string
  senderId: string
}

// GitHub finalize job data
export interface GitHubFinalizeJobData {
  senderId: string
  sessionId: string
  dryRun?: boolean
}

// Cleanup job data
export interface CleanupJobData {
  type: 'expired-sessions' | 'old-batches' | 'temp-files'
  olderThanDays?: number
}

// Stats update job data
export interface StatsUpdateJobData {
  sessionId?: string
  recalculateAll?: boolean
}

// ============================================================================
// QUEUE INSTANCES
// ============================================================================

const queues = new Map<QueueName, Queue>()
const queueEvents = new Map<QueueName, QueueEvents>()

/**
 * Get or create a queue instance
 */
export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  if (!queues.has(name)) {
    const queue = new Queue<T>(name, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600 * 24, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 3600 * 24 * 7, // 7 days
        },
      },
    })
    
    queues.set(name, queue as Queue)
    log.info('Created queue', { name })
  }
  
  return queues.get(name) as Queue<T>
}

/**
 * Get queue events for monitoring
 */
export function getQueueEvents(name: QueueName): QueueEvents {
  if (!queueEvents.has(name)) {
    const events = new QueueEvents(name, {
      connection: getConnectionOptions(),
    })
    
    queueEvents.set(name, events)
  }
  
  return queueEvents.get(name)!
}

// ============================================================================
// QUEUE HELPER FUNCTIONS
// ============================================================================

/**
 * Add a translation job
 */
export async function addTranslationJob(data: TranslateJobData, options?: JobsOptions): Promise<Job<TranslateJobData>> {
  const queue = getQueue<TranslateJobData>(QueueNames.translation)
  
  const job = await queue.add('translate', data, {
    ...options,
    jobId: `translate-${data.senderId}-${Date.now()}`,
  })
  
  log.info('Added translation job', { jobId: job.id, senderId: data.senderId })
  return job
}

/**
 * Add a batch create job
 */
export async function addBatchCreateJob(data: BatchCreateJobData, options?: JobsOptions): Promise<Job<BatchCreateJobData>> {
  const queue = getQueue<BatchCreateJobData>(QueueNames.batchCreate)
  
  const job = await queue.add('create-batch', data, {
    ...options,
    jobId: `batch-create-${data.senderId}-${Date.now()}`,
  })
  
  log.info('Added batch create job', { jobId: job.id, senderId: data.senderId })
  return job
}

/**
 * Add a batch submit job
 */
export async function addBatchSubmitJob(data: BatchSubmitJobData, options?: JobsOptions): Promise<Job<BatchSubmitJobData>> {
  const queue = getQueue<BatchSubmitJobData>(QueueNames.batchSubmit)
  
  const job = await queue.add('submit-batch', data, {
    ...options,
    jobId: `batch-submit-${data.batchId}`,
  })
  
  log.info('Added batch submit job', { jobId: job.id, batchId: data.batchId })
  return job
}

/**
 * Add a batch poll job (for checking OpenAI batch status)
 */
export async function addBatchPollJob(data: BatchPollJobData, options?: JobsOptions): Promise<Job<BatchPollJobData>> {
  const queue = getQueue<BatchPollJobData>(QueueNames.batchPoll)
  
  // Default delay of 30 seconds between polls
  const delay = options?.delay ?? 30000
  
  const job = await queue.add('poll-batch', data, {
    ...options,
    delay,
    jobId: `batch-poll-${data.batchId}-${data.attempt || 1}`,
  })
  
  log.debug('Added batch poll job', { jobId: job.id, batchId: data.batchId, delay })
  return job
}

/**
 * Add a batch process job
 */
export async function addBatchProcessJob(data: BatchProcessJobData, options?: JobsOptions): Promise<Job<BatchProcessJobData>> {
  const queue = getQueue<BatchProcessJobData>(QueueNames.batchProcess)
  
  const job = await queue.add('process-batch', data, {
    ...options,
    jobId: `batch-process-${data.batchId}`,
  })
  
  log.info('Added batch process job', { jobId: job.id, batchId: data.batchId })
  return job
}

/**
 * Add a GitHub finalize job
 */
export async function addGitHubFinalizeJob(data: GitHubFinalizeJobData, options?: JobsOptions): Promise<Job<GitHubFinalizeJobData>> {
  const queue = getQueue<GitHubFinalizeJobData>(QueueNames.githubFinalize)
  
  const job = await queue.add('finalize', data, {
    ...options,
    jobId: `github-finalize-${data.senderId}`,
  })
  
  log.info('Added GitHub finalize job', { jobId: job.id, senderId: data.senderId })
  return job
}

/**
 * Add a cleanup job
 */
export async function addCleanupJob(data: CleanupJobData, options?: JobsOptions): Promise<Job<CleanupJobData>> {
  const queue = getQueue<CleanupJobData>(QueueNames.cleanup)
  
  const job = await queue.add('cleanup', data, {
    ...options,
    jobId: `cleanup-${data.type}-${Date.now()}`,
  })
  
  log.info('Added cleanup job', { jobId: job.id, type: data.type })
  return job
}

/**
 * Schedule recurring cleanup job
 */
export async function scheduleCleanupJob(): Promise<void> {
  const queue = getQueue<CleanupJobData>(QueueNames.cleanup)
  
  // Remove existing repeatable jobs
  const repeatableJobs = await queue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key)
  }
  
  // Add daily cleanup job at 2 AM
  await queue.add(
    'cleanup-expired',
    { type: 'expired-sessions' },
    {
      repeat: {
        pattern: '0 2 * * *', // Every day at 2 AM
      },
      jobId: 'cleanup-expired-sessions',
    }
  )
  
  log.info('Scheduled recurring cleanup job')
}

/**
 * Add a stats update job
 */
export async function addStatsUpdateJob(data: StatsUpdateJobData, options?: JobsOptions): Promise<Job<StatsUpdateJobData>> {
  const queue = getQueue<StatsUpdateJobData>(QueueNames.stats)
  
  const job = await queue.add('update-stats', data, {
    ...options,
    jobId: `stats-update-${data.sessionId || 'all'}-${Date.now()}`,
  })
  
  return job
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  log.info('Closing all queue connections...')
  
  const closePromises: Promise<void>[] = []
  
  for (const [name, queue] of queues) {
    closePromises.push(
      queue.close().then(() => {
        log.debug('Closed queue', { name })
      })
    )
  }
  
  for (const [name, events] of queueEvents) {
    closePromises.push(
      events.close().then(() => {
        log.debug('Closed queue events', { name })
      })
    )
  }
  
  await Promise.all(closePromises)
  
  queues.clear()
  queueEvents.clear()
  
  log.info('All queue connections closed')
}

/**
 * Get queue statistics
 */
export async function getQueueStats(name: QueueName): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}> {
  const queue = getQueue(name)
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])
  
  return { waiting, active, completed, failed, delayed }
}

/**
 * Get all queue statistics
 */
export async function getAllQueueStats(): Promise<Record<QueueName, {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}>> {
  const stats: Record<string, any> = {}
  
  for (const name of Object.values(QueueNames)) {
    stats[name] = await getQueueStats(name)
  }
  
  return stats as Record<QueueName, any>
}

/**
 * Pause a queue
 */
export async function pauseQueue(name: QueueName): Promise<void> {
  const queue = getQueue(name)
  await queue.pause()
  log.info('Paused queue', { name })
}

/**
 * Resume a queue
 */
export async function resumeQueue(name: QueueName): Promise<void> {
  const queue = getQueue(name)
  await queue.resume()
  log.info('Resumed queue', { name })
}

/**
 * Drain a queue (remove all jobs)
 */
export async function drainQueue(name: QueueName): Promise<void> {
  const queue = getQueue(name)
  await queue.drain()
  log.info('Drained queue', { name })
}

/**
 * Clean old jobs from a queue
 */
export async function cleanQueue(
  name: QueueName, 
  grace: number = 0, 
  limit: number = 1000,
  type: 'completed' | 'wait' | 'active' | 'delayed' | 'failed' = 'completed'
): Promise<string[]> {
  const queue = getQueue(name)
  const removed = await queue.clean(grace, limit, type)
  log.info('Cleaned queue', { name, type, removed: removed.length })
  return removed
}
