import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ── settings ─────────────────────────────────────────────────────────────────
// Key-value store for all runtime config: API keys, provider selection,
// translation prompts, git forge settings. Editable via the Settings tab.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
})

// ── sessions ──────────────────────────────────────────────────────────────────
// One row per CI upload or delta. Root entity — everything cascades from here.
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  senderId: text('sender_id').notNull().unique(),
  sessionType: text('session_type').notNull(), // 'upload' | 'changes'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed' | 'expired'
  sourceLocale: text('source_locale').notNull(),
  targetLocales: text('target_locales').notNull(), // JSON array string
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
  repoBranch: text('repo_branch'),
  baseCommitSha: text('base_commit_sha'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  senderIdIdx: index('sessions_sender_id_idx').on(t.senderId),
  statusIdx: index('sessions_status_idx').on(t.status),
  createdAtIdx: index('sessions_created_at_idx').on(t.createdAt),
}))

// ── files ─────────────────────────────────────────────────────────────────────
// All file content stored in DB. No tmp/ filesystem for content.
export const files = sqliteTable('files', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  fileType: text('file_type').notNull(),    // 'upload' | 'translation' | 'delta' | 'original'
  contentType: text('content_type').notNull(), // 'content' | 'global' | 'page'
  format: text('format').notNull(),            // 'markdown' | 'json'
  locale: text('locale').notNull(),
  filePath: text('file_path').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  sessionFileTypeIdx: index('files_session_file_type_idx').on(t.sessionId, t.fileType),
  sessionLocaleIdx: index('files_session_locale_idx').on(t.sessionId, t.locale),
}))

// ── batches ───────────────────────────────────────────────────────────────────
// One row per batch job (OpenAI Batch API or Anthropic Message Batches).
export const batches = sqliteTable('batches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'openai' | 'anthropic'
  status: text('status').notNull().default('pending'), // 'pending' | 'submitted' | 'processing' | 'completed' | 'failed'
  externalBatchId: text('external_batch_id'),
  manifest: text('manifest'), // JSON
  totalRequests: integer('total_requests').notNull().default(0),
  completed: integer('completed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  sessionIdx: index('batches_session_idx').on(t.sessionId),
  statusIdx: index('batches_status_idx').on(t.status),
}))

// ── batch_requests ────────────────────────────────────────────────────────────
// Individual items within a batch.
export const batchRequests = sqliteTable('batch_requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  batchId: text('batch_id').notNull().references(() => batches.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  customId: text('custom_id').notNull(),
  requestBody: text('request_body').notNull(),  // JSON
  responseBody: text('response_body'),           // JSON, null until processed
  status: text('status').notNull().default('pending'), // 'pending' | 'completed' | 'failed'
}, (t) => ({
  batchIdx: index('batch_requests_batch_idx').on(t.batchId),
}))

// ── git_jobs ──────────────────────────────────────────────────────────────────
// Links sessions to git forge output (PR/MR/webhook) once created.
export const gitJobs = sqliteTable('git_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().unique().references(() => sessions.id, { onDelete: 'cascade' }),
  forge: text('forge').notNull(), // 'github' | 'gitlab' | 'webhook' | 'none'
  issueNumber: integer('issue_number'),
  prNumber: integer('pr_number'),
  prUrl: text('pr_url'),
  branch: text('branch'),
  status: text('status').notNull().default('pending'), // 'pending' | 'completed' | 'failed'
  error: text('error'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  sessionIdx: index('git_jobs_session_idx').on(t.sessionId),
}))

// ── jobs ──────────────────────────────────────────────────────────────────────
// In-process queue persistence. One row per background job.
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  jobType: text('job_type').notNull(), // 'batch-poll' | 'batch-process' | 'git-finalize' | 'cleanup' | 'stats-update'
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed'
  payload: text('payload'), // JSON
  error: text('error'),
  runAfter: text('run_after'), // ISO timestamp for delayed execution
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  heartbeatAt: text('heartbeat_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  statusRunAfterIdx: index('jobs_status_run_after_idx').on(t.status, t.runAfter),
  sessionIdx: index('jobs_session_idx').on(t.sessionId),
  jobTypeIdx: index('jobs_job_type_idx').on(t.jobType),
}))

// ── pipeline_events ───────────────────────────────────────────────────────────
// Audit log — one row per pipeline step attempt.
export const pipelineEvents = sqliteTable('pipeline_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  step: text('step').notNull(), // 'upload' | 'batch-create' | 'batch-submit' | 'batch-poll' | 'translate' | 'git-pr' | 'cleanup'
  status: text('status').notNull(), // 'started' | 'completed' | 'failed'
  durationMs: integer('duration_ms'),
  request: text('request'),  // JSON, optional
  response: text('response'), // JSON, optional
  error: text('error'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  sessionIdx: index('pipeline_events_session_idx').on(t.sessionId),
  sessionStepIdx: index('pipeline_events_session_step_idx').on(t.sessionId, t.step),
}))

// ── api_request_logs ──────────────────────────────────────────────────────────
// Raw AI provider HTTP call log — every translation LLM call is recorded here.
export const apiRequestLogs = sqliteTable('api_request_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  requestBody: text('request_body').notNull(),  // JSON
  responseBody: text('response_body'),          // JSON
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms'),
  isMock: integer('is_mock').notNull().default(0), // boolean as 0/1
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()).notNull(),
}, (t) => ({
  sessionIdx: index('api_logs_session_idx').on(t.sessionId),
  providerIdx: index('api_logs_provider_idx').on(t.provider),
}))
