/**
 * Drizzle ORM Schema
 * Defines the PostgreSQL database schema using Drizzle ORM.
 * Migrations are generated via `bun run db:generate` and applied via `bun run db:migrate`.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ============================================================================
// ENUMS (as string literals with CHECK constraints in DB)
// ============================================================================

export const sessionTypeValues = ['upload', 'changes'] as const
export type SessionType = (typeof sessionTypeValues)[number]

export const sessionStatusValues = ['active', 'processing', 'completed', 'failed', 'submitted'] as const
export type SessionStatus = (typeof sessionStatusValues)[number]

export const fileTypeValues = ['upload', 'translation', 'delta', 'original'] as const
export type FileType = (typeof fileTypeValues)[number]

export const contentTypeValues = ['content', 'global', 'page'] as const
export type ContentType = (typeof contentTypeValues)[number]

export const fileFormatValues = ['markdown', 'json'] as const
export type FileFormat = (typeof fileFormatValues)[number]

export const jobTypeValues = ['content', 'global', 'page'] as const
export type JobType = (typeof jobTypeValues)[number]

export const batchStatusValues = ['created', 'submitted', 'processing', 'completed', 'failed', 'cancelled'] as const
export type BatchStatus = (typeof batchStatusValues)[number]

export const openAIBatchStatusValues = ['validating', 'failed', 'in_progress', 'finalizing', 'completed', 'expired', 'cancelling', 'cancelled'] as const
export type OpenAIBatchStatus = (typeof openAIBatchStatusValues)[number]

export const batchRequestStatusValues = ['pending', 'completed', 'failed'] as const
export type BatchRequestStatus = (typeof batchRequestStatusValues)[number]

export const pipelineStepValues = [
  'upload',
  'batch-create',
  'batch-submit',
  'batch-poll',
  'batch-process',
  'translate',
  'github-finalize',
  'github-pr',
  'cleanup'
] as const
export type PipelineStep = (typeof pipelineStepValues)[number]

export const pipelineEventStatusValues = ['started', 'in-progress', 'completed', 'failed', 'cancelled', 'retrying'] as const
export type PipelineEventStatus = (typeof pipelineEventStatusValues)[number]

export const jobQueueStatusValues = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
export type JobQueueStatus = (typeof jobQueueStatusValues)[number]

export const jobQueueNameValues = [
  'batch-poll',
  'batch-process',
  'github-finalize',
  'cleanup',
  'stats-update',
] as const
export type JobQueueName = (typeof jobQueueNameValues)[number]

// ============================================================================
// SESSIONS TABLE
// ============================================================================

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: varchar('sender_id', { length: 255 }).notNull().unique(),
  sessionType: varchar('session_type', { length: 50 }).notNull().$type<SessionType>(),
  status: varchar('status', { length: 50 }).notNull().default('active').$type<SessionStatus>(),

  // Repository information (for changes workflow)
  repositoryOwner: varchar('repository_owner', { length: 255 }),
  repositoryName: varchar('repository_name', { length: 255 }),
  baseBranch: varchar('base_branch', { length: 255 }),
  baseCommitSha: varchar('base_commit_sha', { length: 40 }),
  commitSha: varchar('commit_sha', { length: 40 }),
  commitMessage: text('commit_message'),
  commitAuthor: varchar('commit_author', { length: 255 }),
  commitTimestamp: timestamp('commit_timestamp', { withTimezone: true }),

  // Locale information
  sourceLocale: varchar('source_locale', { length: 10 }).notNull(),
  targetLocales: text('target_locales').array(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Additional metadata
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
}, (table) => [
  index('idx_sessions_sender_id').on(table.senderId),
  index('idx_sessions_status').on(table.status),
  index('idx_sessions_type').on(table.sessionType),
  index('idx_sessions_created_at').on(table.createdAt),
])

// ============================================================================
// TRANSLATION_JOBS TABLE
// ============================================================================

export const translationJobs = pgTable('translation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  jobId: varchar('job_id', { length: 255 }).notNull(),
  jobType: varchar('job_type', { length: 50 }).$type<JobType>(),

  // Translation details
  sourceLocale: varchar('source_locale', { length: 10 }).notNull(),
  targetLocales: text('target_locales').array(),

  // GitHub integration
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  githubPrNumber: integer('github_pr_number'),
  githubPrUrl: text('github_pr_url'),
  githubBranch: varchar('github_branch', { length: 255 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_translation_jobs_session').on(table.sessionId),
  index('idx_translation_jobs_job_id').on(table.jobId),
  unique('translation_jobs_session_job_unique').on(table.sessionId, table.jobId),
])

// ============================================================================
// FILES TABLE
// ============================================================================

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => translationJobs.id, { onDelete: 'set null' }),

  // File classification
  fileType: varchar('file_type', { length: 50 }).notNull().$type<FileType>(),
  contentType: varchar('content_type', { length: 50 }).notNull().$type<ContentType>(),
  format: varchar('format', { length: 20 }).notNull().$type<FileFormat>(),

  // File location/identification
  locale: varchar('locale', { length: 10 }).notNull(),
  relativePath: text('relative_path').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),

  // File content
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }),
  fileSize: integer('file_size'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // Additional metadata
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
}, (table) => [
  index('idx_files_session').on(table.sessionId),
  index('idx_files_type').on(table.fileType),
  index('idx_files_content_type').on(table.contentType),
  index('idx_files_locale').on(table.locale),
  index('idx_files_path').on(table.relativePath),
  unique('files_session_type_locale_path_unique').on(table.sessionId, table.fileType, table.locale, table.relativePath),
])

// ============================================================================
// BATCHES TABLE
// ============================================================================

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: varchar('batch_id', { length: 255 }).notNull().unique(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),

  // Batch configuration
  sourceLocale: varchar('source_locale', { length: 10 }).notNull(),
  targetLocales: text('target_locales').array(),
  contentTypes: text('content_types').array(),
  model: varchar('model', { length: 100 }).notNull(),

  // OpenAI Batch API details
  openaiBatchId: varchar('openai_batch_id', { length: 255 }),
  openaiStatus: varchar('openai_status', { length: 50 }).$type<OpenAIBatchStatus>(),

  // Progress tracking
  totalRequests: integer('total_requests').notNull().default(0),
  completedRequests: integer('completed_requests').default(0),
  failedRequests: integer('failed_requests').default(0),

  // Status
  status: varchar('status', { length: 50 }).notNull().default('created').$type<BatchStatus>(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  // Error tracking
  errorMessage: text('error_message'),

  // Manifest data
  manifest: jsonb('manifest').notNull().$type<BatchManifest>(),
}, (table) => [
  index('idx_batches_batch_id').on(table.batchId),
  index('idx_batches_session').on(table.sessionId),
  index('idx_batches_status').on(table.status),
  index('idx_batches_created_at').on(table.createdAt),
])

// Type for BatchManifest
export interface BatchManifest {
  batchId: string
  senderId: string
  sourceLocale: string
  targetLocales: string[]
  contentTypes: string[]
  model: string
  totalRequests: number
  files: Array<{
    relativePath: string
    contentType: string
    targetLocales: string[]
  }>
  createdAt: string
}

// ============================================================================
// BATCH_REQUESTS TABLE
// ============================================================================

export const batchRequests = pgTable('batch_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id').notNull().references(() => batches.id, { onDelete: 'cascade' }),

  // Request identification
  customId: varchar('custom_id', { length: 255 }).notNull(),
  requestIndex: integer('request_index').notNull(),

  // File reference
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  relativePath: text('relative_path').notNull(),
  targetLocale: varchar('target_locale', { length: 10 }).notNull(),

  // Request details
  requestBody: jsonb('request_body').notNull().$type<Record<string, unknown>>(),

  // Response details
  responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
  responseStatus: integer('response_status'),

  // Status
  status: varchar('status', { length: 50 }).notNull().default('pending').$type<BatchRequestStatus>(),
  errorMessage: text('error_message'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_batch_requests_batch').on(table.batchId),
  index('idx_batch_requests_status').on(table.status),
  index('idx_batch_requests_locale').on(table.targetLocale),
  index('idx_batch_requests_custom_id').on(table.customId),
  unique('batch_requests_batch_custom_unique').on(table.batchId, table.customId),
])

// ============================================================================
// TRANSLATION_STATS TABLE
// ============================================================================

export const translationStats = pgTable('translation_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),

  // Counts by type
  uploadsCount: integer('uploads_count').default(0),
  translationsCount: integer('translations_count').default(0),

  // Counts by content type
  contentFiles: integer('content_files').default(0),
  globalFiles: integer('global_files').default(0),
  pageFiles: integer('page_files').default(0),

  // Locale coverage
  sourceLocale: varchar('source_locale', { length: 10 }),
  targetLocalesCount: integer('target_locales_count').default(0),
  completedLocales: text('completed_locales').array(),

  // Batch statistics
  batchesCount: integer('batches_count').default(0),
  activeBatches: integer('active_batches').default(0),
  completedBatches: integer('completed_batches').default(0),

  // Timestamps
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),

  // Additional stats
  stats: jsonb('stats').default({}).$type<Record<string, unknown>>(),
}, (table) => [
  index('idx_translation_stats_session').on(table.sessionId),
  index('idx_translation_stats_calculated').on(table.calculatedAt),
])

// ============================================================================
// PIPELINE_EVENTS TABLE - Tracks pipeline step execution for debugging/visibility
// ============================================================================

export const pipelineEvents = pgTable('pipeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),

  // Step identification
  step: varchar('step', { length: 50 }).notNull().$type<PipelineStep>(),
  status: varchar('status', { length: 50 }).notNull().$type<PipelineEventStatus>(),

  // Event details
  message: text('message'),
  durationMs: integer('duration_ms'),

  // Request/Response data for debugging (can be large)
  requestData: jsonb('request_data').$type<Record<string, unknown>>(),
  responseData: jsonb('response_data').$type<Record<string, unknown>>(),
  errorData: jsonb('error_data').$type<{ message: string; stack?: string; code?: string }>(),

  // Context
  batchId: varchar('batch_id', { length: 255 }),
  jobId: varchar('job_id', { length: 255 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_pipeline_events_session').on(table.sessionId),
  index('idx_pipeline_events_step').on(table.step),
  index('idx_pipeline_events_status').on(table.status),
  index('idx_pipeline_events_created').on(table.createdAt),
])

// ============================================================================
// API_REQUEST_LOGS TABLE - Stores all API requests for inspection
// ============================================================================

export const apiRequestLogs = pgTable('api_request_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),

  // Request identification
  provider: varchar('provider', { length: 50 }).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  method: varchar('method', { length: 10 }).notNull().default('POST'),

  // Request details
  requestHeaders: jsonb('request_headers').$type<Record<string, string>>(),
  requestBody: jsonb('request_body').$type<Record<string, unknown>>(),

  // Response details
  responseStatus: integer('response_status'),
  responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
  responseBody: jsonb('response_body').$type<Record<string, unknown>>(),

  // Error details
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),

  // Timing
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // Context
  filePath: text('file_path'),
  sourceLocale: varchar('source_locale', { length: 10 }),
  targetLocale: varchar('target_locale', { length: 10 }),

  // Mock mode indicator
  isMock: varchar('is_mock', { length: 5 }).default('false'),
}, (table) => [
  index('idx_api_logs_session').on(table.sessionId),
  index('idx_api_logs_provider').on(table.provider),
  index('idx_api_logs_created').on(table.createdAt),
  index('idx_api_logs_status').on(table.responseStatus),
])

// ============================================================================
// JOB_QUEUE TABLE - PostgreSQL-based job queue (pg-boss pattern)
// Uses SKIP LOCKED for safe concurrent job claiming
// ============================================================================

export const jobQueue = pgTable('job_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Job identification
  name: varchar('name', { length: 50 }).notNull().$type<JobQueueName>(),
  status: varchar('status', { length: 20 }).notNull().default('pending').$type<JobQueueStatus>(),
  
  // Job data (JSON payload)
  data: jsonb('data').notNull().$type<Record<string, unknown>>(),
  
  // Scheduling
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  
  // Retry configuration
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  
  // Result/Error tracking
  result: jsonb('result').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  
  // Worker identification (for debugging)
  workerId: varchar('worker_id', { length: 255 }),
  
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  
  // Expiration (for completed/failed jobs cleanup)
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  index('idx_job_queue_name').on(table.name),
  index('idx_job_queue_status').on(table.status),
  index('idx_job_queue_run_at').on(table.runAt),
  index('idx_job_queue_pending').on(table.name, table.status, table.runAt),
])

// ============================================================================
// SYSTEM_CONFIG TABLE - Stores system-wide configuration (translation settings, etc.)
// ============================================================================

export const systemConfig = pgTable('system_config', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Configuration key (unique identifier)
  key: varchar('key', { length: 255 }).notNull().unique(),

  // Configuration value (stored as JSONB for flexibility)
  value: jsonb('value').notNull().$type<unknown>(),

  // Encrypted value for sensitive data (API keys)
  encryptedValue: text('encrypted_value'),

  // Masked preview of sensitive value (last 5 chars visible)
  maskedPreview: varchar('masked_preview', { length: 50 }),

  // Description of the configuration
  description: text('description'),

  // Whether this is a sensitive value (API keys, secrets)
  isSensitive: varchar('is_sensitive', { length: 5 }).notNull().default('false'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_system_config_key').on(table.key),
])

// Type exports for system config
export type SystemConfig = typeof systemConfig.$inferSelect
export type NewSystemConfig = typeof systemConfig.$inferInsert

// ============================================================================
// RELATIONS
// ============================================================================

export const sessionsRelations = relations(sessions, ({ many }) => ({
  translationJobs: many(translationJobs),
  files: many(files),
  batches: many(batches),
  translationStats: many(translationStats),
  pipelineEvents: many(pipelineEvents),
  apiRequestLogs: many(apiRequestLogs),
}))

export const translationJobsRelations = relations(translationJobs, ({ one, many }) => ({
  session: one(sessions, {
    fields: [translationJobs.sessionId],
    references: [sessions.id],
  }),
  files: many(files),
}))

export const filesRelations = relations(files, ({ one }) => ({
  session: one(sessions, {
    fields: [files.sessionId],
    references: [sessions.id],
  }),
  job: one(translationJobs, {
    fields: [files.jobId],
    references: [translationJobs.id],
  }),
}))

export const batchesRelations = relations(batches, ({ one, many }) => ({
  session: one(sessions, {
    fields: [batches.sessionId],
    references: [sessions.id],
  }),
  requests: many(batchRequests),
}))

export const batchRequestsRelations = relations(batchRequests, ({ one }) => ({
  batch: one(batches, {
    fields: [batchRequests.batchId],
    references: [batches.id],
  }),
  file: one(files, {
    fields: [batchRequests.fileId],
    references: [files.id],
  }),
}))

export const translationStatsRelations = relations(translationStats, ({ one }) => ({
  session: one(sessions, {
    fields: [translationStats.sessionId],
    references: [sessions.id],
  }),
}))

export const pipelineEventsRelations = relations(pipelineEvents, ({ one }) => ({
  session: one(sessions, {
    fields: [pipelineEvents.sessionId],
    references: [sessions.id],
  }),
}))

export const apiRequestLogsRelations = relations(apiRequestLogs, ({ one }) => ({
  session: one(sessions, {
    fields: [apiRequestLogs.sessionId],
    references: [sessions.id],
  }),
}))

// ============================================================================
// TYPE EXPORTS (inferred from tables)
// ============================================================================

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export type TranslationJob = typeof translationJobs.$inferSelect
export type NewTranslationJob = typeof translationJobs.$inferInsert

export type File = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert

export type Batch = typeof batches.$inferSelect
export type NewBatch = typeof batches.$inferInsert

export type BatchRequest = typeof batchRequests.$inferSelect
export type NewBatchRequest = typeof batchRequests.$inferInsert

export type TranslationStat = typeof translationStats.$inferSelect
export type NewTranslationStat = typeof translationStats.$inferInsert

export type PipelineEvent = typeof pipelineEvents.$inferSelect
export type NewPipelineEvent = typeof pipelineEvents.$inferInsert

export type ApiRequestLog = typeof apiRequestLogs.$inferSelect
export type NewApiRequestLog = typeof apiRequestLogs.$inferInsert

export type JobQueueItem = typeof jobQueue.$inferSelect
export type NewJobQueueItem = typeof jobQueue.$inferInsert
