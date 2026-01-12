/**
 * PostgreSQL Queue Workers
 * Processes jobs from the PostgreSQL job queue using polling
 */
import { 
  claimJob, 
  completeJob, 
  failJob, 
  retryJob,
  addBatchPollJob,
  addBatchProcessJob,
  addCleanupJob,
  cleanOldJobs,
  resetStaleJobs,
  type BatchPollJobData,
  type BatchProcessJobData,
  type GitHubFinalizeJobData,
  type CleanupJobData,
  type JobData,
} from './pgQueue'
import { createScopedLogger } from '../utils/logger'
import * as batchRepository from '../repositories/batchRepository'

const log = createScopedLogger('workers:pg')

// Worker configuration
const POLL_INTERVAL_MS = 1000 // Check for jobs every second
const STALE_JOB_CHECK_INTERVAL_MS = 60 * 1000 // Check for stale jobs every minute

// Store interval handles for graceful shutdown
const workerIntervals: Timer[] = []
let isRunning = false

// ============================================================================
// JOB HANDLERS
// ============================================================================

/**
 * Handle batch poll jobs
 */
async function handleBatchPollJob(data: JobData): Promise<Record<string, unknown>> {
  const jobData = data as BatchPollJobData
  const { batchId, openaiBatchId, senderId, attempt = 1 } = jobData
  
  log.info('Polling batch status', { batchId, openaiBatchId, attempt })
  
  // Get batch from database
  const batch = await batchRepository.getBatchByBatchId(batchId)
  
  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`)
  }
  
  // Check if batch is already completed or failed
  if (['completed', 'failed', 'cancelled'].includes(batch.status)) {
    log.info('Batch already in terminal state', { batchId, status: batch.status })
    return { status: batch.status, skipped: true }
  }
  
  // Import OpenAI service dynamically to avoid circular deps
  const { checkBatchStatus } = await import('../services/translation/openaiBatchService')
  
  // Check status with OpenAI
  const statusResult = await checkBatchStatus({ senderId, batchId })
  
  // Update batch in database
  await batchRepository.updateBatch(batchId, {
    openaiStatus: statusResult.status as batchRepository.OpenAIBatchStatus,
    completedRequests: statusResult.requestCounts?.completed ?? 0,
    failedRequests: statusResult.requestCounts?.failed ?? 0,
  })
  
  // Handle terminal states
  if (statusResult.status === 'completed') {
    log.info('Batch completed, queuing processing job', { batchId })
    await addBatchProcessJob({ batchId, senderId })
    return { status: 'completed', willProcess: true }
  }
  
  if (statusResult.status === 'failed' || statusResult.status === 'cancelled' || statusResult.status === 'expired') {
    log.warn('Batch failed', { batchId, status: statusResult.status })
    await batchRepository.markBatchFailed(batchId, `OpenAI batch ${statusResult.status}`)
    return { status: statusResult.status, failed: true }
  }
  
  // Still in progress - schedule another poll
  const nextAttempt = attempt + 1
  const maxAttempts = 1000 // ~8 hours with 30s intervals
  
  if (nextAttempt <= maxAttempts) {
    // Increase delay slightly as we wait longer
    const delay = Math.min(30000 + (attempt * 1000), 60000) // 30s to 60s
    
    await addBatchPollJob(
      { batchId, senderId, openaiBatchId, attempt: nextAttempt },
      { delay }
    )
    
    log.debug('Scheduled next poll', { batchId, nextAttempt, delay })
  } else {
    log.error('Max poll attempts reached', { batchId, attempts: maxAttempts })
    await batchRepository.markBatchFailed(batchId, 'Max poll attempts reached')
  }
  
  return { status: statusResult.status, attempt: nextAttempt }
}

/**
 * Handle batch process jobs
 */
async function handleBatchProcessJob(data: JobData): Promise<Record<string, unknown>> {
  const jobData = data as BatchProcessJobData
  const { batchId, senderId } = jobData
  
  log.info('Processing batch output', { batchId, senderId })
  
  // Get batch from database to get the OpenAI output file ID
  const batch = await batchRepository.getBatchByBatchId(batchId)
  if (!batch || !batch.openaiBatchId) {
    throw new Error(`Batch not found or no OpenAI batch ID: ${batchId}`)
  }
  
  // Import OpenAI client and get API key from config
  const { default: OpenAI } = await import('openai')
  const { getDecryptedConfig, ConfigKeys } = await import('../repositories/configRepository')
  
  // Get API key from database config, fall back to environment variable
  const apiKey = await getDecryptedConfig(ConfigKeys.OPENAI_API_KEY) ?? process.env.OPENAI_API_KEY
  const baseURL = process.env.OPENAI_API_URL
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }
  
  const openai = new OpenAI({
    apiKey,
    baseURL,
  })
  
  // Get batch to find output file
  const openaiBatch = await openai.batches.retrieve(batch.openaiBatchId)
  
  if (!openaiBatch.output_file_id) {
    throw new Error(`Batch ${batchId} has no output file`)
  }
  
  // Download output file content
  const fileContent = await openai.files.content(openaiBatch.output_file_id)
  const outputContent = await fileContent.text()
  
  // Process the output
  const { processBatchOutput } = await import('../services/translation/batchOutputProcessor')
  const results = await processBatchOutput({ senderId, batchId, outputContent })
  
  // Count successes and failures
  const successful = results.filter(r => r.status === 'success').length
  const failed = results.filter(r => r.status === 'error').length
  
  // Update batch status
  await batchRepository.markBatchCompleted(batchId, successful, failed)
  log.info('Batch processed successfully', { batchId, filesWritten: successful, failed })
  
  return { 
    success: true, 
    filesWritten: successful,
    errors: failed,
  }
}

/**
 * Handle GitHub finalize jobs
 */
async function handleGitHubFinalizeJob(data: JobData): Promise<Record<string, unknown>> {
  const jobData = data as GitHubFinalizeJobData
  const { senderId, dryRun } = jobData
  
  log.info('Finalizing GitHub workflow', { senderId, dryRun })
  
  // Import workflow dynamically
  const { finalizeTranslationJob } = await import('../services/github/workflow')
  
  const result = await finalizeTranslationJob({ senderId, dryRun })
  
  return { 
    senderId: result.senderId,
    branchName: result.branchName,
    pullRequestUrl: result.pullRequestUrl,
    pullRequestNumber: result.pullRequestNumber,
  }
}

/**
 * Handle cleanup jobs
 */
async function handleCleanupJob(data: JobData): Promise<Record<string, unknown>> {
  const jobData = data as CleanupJobData
  const { type, olderThanDays = 7 } = jobData
  
  log.info('Running cleanup job', { type, olderThanDays })
  
  let cleaned = 0
  
  switch (type) {
    case 'old-jobs':
      cleaned = await cleanOldJobs(olderThanDays * 24 * 60 * 60 * 1000)
      break
    
    case 'expired-sessions':
      // TODO: Implement session cleanup
      break
    
    case 'old-batches':
      // TODO: Implement batch cleanup
      break
  }
  
  // Schedule next cleanup
  await addCleanupJob({ type: 'old-jobs' }, { delay: 60 * 60 * 1000 }) // 1 hour
  
  return { type, cleaned }
}

// ============================================================================
// WORKER POLLING LOOPS
// ============================================================================

type JobHandler = (data: JobData) => Promise<Record<string, unknown>>

/**
 * Create a worker polling loop for a specific queue
 */
function createWorkerLoop(
  queueName: 'batch-poll' | 'batch-process' | 'github-finalize' | 'cleanup',
  handler: JobHandler
): Timer {
  return setInterval(async () => {
    if (!isRunning) return
    
    try {
      const job = await claimJob(queueName)
      
      if (!job) return // No jobs available
      
      log.debug('Processing job', { queueName, jobId: job.id })
      
      try {
        const result = await handler(job.data as JobData)
        await completeJob(job.id, result)
      } catch (error) {
        log.error('Job failed', { queueName, jobId: job.id, error })
        
        // Check if we should retry
        if (job.attempts < job.maxAttempts) {
          const delay = Math.min(30000 * job.attempts, 300000) // Exponential backoff, max 5 min
          await retryJob(job.id, delay)
        } else {
          await failJob(job.id, error instanceof Error ? error : String(error))
        }
      }
    } catch (error) {
      log.error('Error in worker loop', { queueName, error })
    }
  }, POLL_INTERVAL_MS)
}

/**
 * Start all workers
 */
export function startAllWorkers(): void {
  if (isRunning) {
    log.warn('Workers already running')
    return
  }
  
  log.info('Starting PostgreSQL queue workers...')
  isRunning = true
  
  // Create worker loops for each queue type
  workerIntervals.push(
    createWorkerLoop('batch-poll', handleBatchPollJob),
    createWorkerLoop('batch-process', handleBatchProcessJob),
    createWorkerLoop('github-finalize', handleGitHubFinalizeJob),
    createWorkerLoop('cleanup', handleCleanupJob)
  )
  
  // Also start a background loop to reset stale jobs
  workerIntervals.push(
    setInterval(async () => {
      if (!isRunning) return
      try {
        await resetStaleJobs()
      } catch (error) {
        log.error('Error resetting stale jobs', { error })
      }
    }, STALE_JOB_CHECK_INTERVAL_MS)
  )
  
  log.info('PostgreSQL queue workers started', { count: workerIntervals.length })
}

/**
 * Stop all workers gracefully
 */
export async function stopAllWorkers(): Promise<void> {
  log.info('Stopping PostgreSQL queue workers...')
  isRunning = false
  
  for (const interval of workerIntervals) {
    clearInterval(interval)
  }
  workerIntervals.length = 0
  
  log.info('PostgreSQL queue workers stopped')
}

/**
 * Check if workers are running
 */
export function areWorkersRunning(): boolean {
  return isRunning
}

/**
 * Get worker count
 */
export function getWorkerCount(): number {
  return workerIntervals.length
}
