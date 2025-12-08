/**
 * BullMQ Queue Workers
 * Processes jobs from the translation queues
 */
import { Worker, Job } from 'bullmq'
import { 
  getConnectionOptions, 
  QueueNames,
  addBatchPollJob,
  addBatchProcessJob,
  type BatchCreateJobData,
  type BatchSubmitJobData,
  type BatchPollJobData,
  type BatchProcessJobData,
  type GitHubFinalizeJobData,
  type CleanupJobData,
  type TranslateJobData,
} from './index'
import { createScopedLogger } from '../utils/logger'
import * as batchRepository from '../repositories/batchRepository'
import * as sessionRepository from '../repositories/sessionRepository'
import { 
  publishBatchEvent, 
  Channels,
  invalidateBatchCache,
  invalidateDashboardCache 
} from '../cache'

const log = createScopedLogger('workers')

// Store worker instances for graceful shutdown
const workers: Worker[] = []

// ============================================================================
// BATCH POLL WORKER
// ============================================================================

/**
 * Worker that polls OpenAI batch status
 */
export function createBatchPollWorker(): Worker<BatchPollJobData> {
  const worker = new Worker<BatchPollJobData>(
    QueueNames.batchPoll,
    async (job: Job<BatchPollJobData>) => {
      const { batchId, openaiBatchId, senderId, attempt = 1 } = job.data
      
      log.info('Polling batch status', { batchId, openaiBatchId, attempt })
      
      try {
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
        
        // Invalidate cache
        await invalidateBatchCache(batchId)
        
        // Publish status update event
        await publishBatchEvent(Channels.batchStatusChanged, {
          batchId,
          senderId,
          status: statusResult.status,
          progress: {
            total: statusResult.requestCounts?.total ?? 0,
            completed: statusResult.requestCounts?.completed ?? 0,
            failed: statusResult.requestCounts?.failed ?? 0,
          },
          timestamp: new Date().toISOString(),
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
          
          await publishBatchEvent(Channels.batchFailed, {
            batchId,
            senderId,
            status: statusResult.status,
            timestamp: new Date().toISOString(),
          })
          
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
      } catch (error) {
        log.error('Error polling batch', { batchId, error })
        throw error
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000, // 10 requests per second max
      },
    }
  )
  
  worker.on('completed', (job) => {
    log.debug('Batch poll job completed', { jobId: job.id })
  })
  
  worker.on('failed', (job, error) => {
    log.error('Batch poll job failed', { jobId: job?.id, error: error.message })
  })
  
  workers.push(worker)
  return worker
}

// ============================================================================
// BATCH PROCESS WORKER
// ============================================================================

/**
 * Worker that processes completed OpenAI batch output
 */
export function createBatchProcessWorker(): Worker<BatchProcessJobData> {
  const worker = new Worker<BatchProcessJobData>(
    QueueNames.batchProcess,
    async (job: Job<BatchProcessJobData>) => {
      const { batchId, senderId } = job.data
      
      log.info('Processing batch output', { batchId })
      
      try {
        // Get batch to retrieve output content
        const batch = await batchRepository.getBatchByBatchId(batchId)
        if (!batch) {
          throw new Error(`Batch not found: ${batchId}`)
        }
        
        // Import processor dynamically
        const { processBatchOutput } = await import('../services/translation/batchOutputProcessor')
        const { readBatchFile, batchFileExists } = await import('../utils/batchStorage')
        
        // Find and read output file (downloaded during checkBatchStatus)
        // The file is named {openaiBatchId}_output.jsonl
        const openaiBatchId = batch.openaiBatchId
        if (!openaiBatchId) {
          throw new Error(`Batch ${batchId} has no OpenAI batch ID`)
        }
        
        const outputFileName = `${openaiBatchId}_output.jsonl`
        if (!batchFileExists(senderId, batchId, outputFileName)) {
          throw new Error(`Output file not found for batch ${batchId}`)
        }
        
        const outputContent = readBatchFile(senderId, batchId, outputFileName)
        
        // Process the batch output
        const results = await processBatchOutput({ senderId, batchId, outputContent })
        
        // Count successful and failed
        const successful = results.filter(r => r.status === 'success').length
        const failed = results.filter(r => r.status === 'error').length
        const total = results.length
        
        // Update batch status
        await batchRepository.markBatchCompleted(batchId, successful, failed)
        
        // Invalidate caches
        await invalidateBatchCache(batchId)
        await invalidateDashboardCache()
        
        // Publish completion event
        await publishBatchEvent(Channels.batchCompleted, {
          batchId,
          senderId,
          status: 'completed',
          progress: { total, completed: successful, failed },
          timestamp: new Date().toISOString(),
        })
        
        log.info('Batch processing completed', { batchId, successful, failed })
        
        return { total, successful, failed }
      } catch (error) {
        log.error('Error processing batch', { batchId, error })
        
        await batchRepository.markBatchFailed(
          batchId, 
          error instanceof Error ? error.message : 'Unknown error'
        )
        
        throw error
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 2, // Limit concurrent processing
    }
  )
  
  worker.on('completed', (job) => {
    log.info('Batch process job completed', { jobId: job.id })
  })
  
  worker.on('failed', (job, error) => {
    log.error('Batch process job failed', { jobId: job?.id, error: error.message })
  })
  
  workers.push(worker)
  return worker
}

// ============================================================================
// CLEANUP WORKER
// ============================================================================

/**
 * Worker that handles cleanup tasks
 */
export function createCleanupWorker(): Worker<CleanupJobData> {
  const worker = new Worker<CleanupJobData>(
    QueueNames.cleanup,
    async (job: Job<CleanupJobData>) => {
      const { type, olderThanDays = 7 } = job.data
      
      log.info('Running cleanup job', { type, olderThanDays })
      
      try {
        switch (type) {
          case 'expired-sessions': {
            const count = await sessionRepository.cleanupExpiredSessions()
            log.info('Cleaned up expired sessions', { count })
            return { type, cleaned: count }
          }
          
          case 'old-batches': {
            // Clean batches older than specified days
            // This would require adding a method to batch repository
            log.info('Old batch cleanup not yet implemented')
            return { type, cleaned: 0 }
          }
          
          case 'temp-files': {
            // Clean temporary files if any
            log.info('Temp file cleanup not yet implemented')
            return { type, cleaned: 0 }
          }
          
          default:
            log.warn('Unknown cleanup type', { type })
            return { type, cleaned: 0 }
        }
      } catch (error) {
        log.error('Error in cleanup job', { type, error })
        throw error
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    }
  )
  
  worker.on('completed', (job) => {
    log.debug('Cleanup job completed', { jobId: job.id })
  })
  
  worker.on('failed', (job, error) => {
    log.error('Cleanup job failed', { jobId: job?.id, error: error.message })
  })
  
  workers.push(worker)
  return worker
}

// ============================================================================
// GITHUB FINALIZE WORKER
// ============================================================================

/**
 * Worker that handles GitHub PR creation
 */
export function createGitHubFinalizeWorker(): Worker<GitHubFinalizeJobData> {
  const worker = new Worker<GitHubFinalizeJobData>(
    QueueNames.githubFinalize,
    async (job: Job<GitHubFinalizeJobData>) => {
      const { senderId, sessionId, dryRun = false } = job.data
      
      log.info('Finalizing GitHub PR', { senderId, dryRun })
      
      try {
        // Import GitHub workflow dynamically
        const { finalizeTranslationJob } = await import('../services/github/workflow')
        
        // Run finalization
        const result = await finalizeTranslationJob({ senderId, dryRun })
        
        log.info('GitHub finalization completed', { 
          senderId, 
          prNumber: result.pullRequestNumber,
          prUrl: result.pullRequestUrl 
        })
        
        return result
      } catch (error) {
        log.error('Error finalizing GitHub PR', { senderId, error })
        throw error
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 2, // Limit concurrent GitHub operations
      limiter: {
        max: 5,
        duration: 60000, // 5 per minute to respect rate limits
      },
    }
  )
  
  worker.on('completed', (job) => {
    log.info('GitHub finalize job completed', { jobId: job.id })
  })
  
  worker.on('failed', (job, error) => {
    log.error('GitHub finalize job failed', { jobId: job?.id, error: error.message })
  })
  
  workers.push(worker)
  return worker
}

// ============================================================================
// WORKER MANAGEMENT
// ============================================================================

/**
 * Start all workers
 */
export function startAllWorkers(): void {
  log.info('Starting all queue workers...')
  
  createBatchPollWorker()
  createBatchProcessWorker()
  createCleanupWorker()
  createGitHubFinalizeWorker()
  
  log.info('All queue workers started', { count: workers.length })
}

/**
 * Stop all workers gracefully
 */
export async function stopAllWorkers(): Promise<void> {
  log.info('Stopping all queue workers...')
  
  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close()
    } catch (error) {
      log.error('Error closing worker', { error })
    }
  })
  
  await Promise.all(closePromises)
  workers.length = 0
  
  log.info('All queue workers stopped')
}

/**
 * Check if workers are running
 */
export function areWorkersRunning(): boolean {
  return workers.length > 0 && workers.every(w => w.isRunning())
}

/**
 * Get worker count
 */
export function getWorkerCount(): number {
  return workers.length
}
