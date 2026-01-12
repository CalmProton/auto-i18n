/**
 * Queue Module Exports
 * 
 * PostgreSQL-based job queue implementation.
 * 
 */

// Re-export everything from the PostgreSQL queue module
export {
  // Job data types
  type BatchPollJobData,
  type BatchProcessJobData,
  type GitHubFinalizeJobData,
  type CleanupJobData,
  type StatsUpdateJobData,
  type JobData,
  type AddJobOptions,
  
  // Job creation functions
  addJob,
  addBatchPollJob,
  addBatchProcessJob,
  addGitHubFinalizeJob,
  addCleanupJob,
  addStatsUpdateJob,
  
  // Job processing functions
  claimJob,
  completeJob,
  failJob,
  retryJob,
  cancelJob,
  
  // Queue management
  getQueueStats,
  getAllQueueStats,
  cleanOldJobs,
  resetStaleJobs,
  getPendingJobs,
  scheduleCleanupJob,
} from './pgQueue'

// Re-export worker functions
export {
  startAllWorkers,
  stopAllWorkers,
  areWorkersRunning,
  getWorkerCount,
} from './pgWorkers'

/**
 * Close all queues (no-op for PostgreSQL queue, kept for API compatibility)
 */
export async function closeAllQueues(): Promise<void> {
  // No persistent connections to close with PostgreSQL queue
  // The database connection is managed by the database module
}
