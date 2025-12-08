/**
 * Frontend API Types
 * TypeScript types matching the backend API responses
 */

export type UploadStatus = 'uploaded' | 'batched' | 'translating' | 'completed'
export type BatchStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'partially_failed'
export type JobType = 'openai-batch' | 'regular-translation'
export type TranslationProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter'
export type SessionType = 'full-upload' | 'change-session'
export type PipelineStatus = 'uploaded' | 'batch-created' | 'submitted' | 'processing' | 'completed' | 'failed' | 'pr-created'
export type AutomationMode = 'auto' | 'manual'
export type TranslationType = 'full' | 'delta'

export interface DashboardOverview {
  totalUploads: number
  completedBatches: number
  failedBatches: number
  totalTranslations: number
  readyForPR: number
}

export interface FileCount {
  content: number
  global: number
  page: number
  total: number
}

export interface TranslationProgress {
  completed: number
  total: number
  percentage: number
}

export interface StepStatus {
  completed: boolean
  timestamp?: string
  error?: string
}

export interface PipelineSteps {
  uploaded: StepStatus
  batchCreated: StepStatus & { batchId?: string }
  submitted: StepStatus & { openAiBatchId?: string }
  processing: StepStatus & { progress?: number }
  outputReceived: StepStatus
  translationsProcessed: StepStatus & { translationCount?: number }
  prCreated: StepStatus & { pullRequestNumber?: number; pullRequestUrl?: string }
}

export interface CommitInfo {
  sha: string
  shortSha: string
  message: string
  author?: string
  timestamp: string
}

export interface ChangeCount {
  added: number
  modified: number
  deleted: number
  total: number
}

export interface Upload {
  senderId: string
  sessionType: SessionType
  repository?: { owner: string; name: string }
  sourceLocale: string
  targetLocales: string[]
  fileCount: FileCount
  status: UploadStatus
  createdAt: string
  updatedAt: string
  batchIds?: string[]
  jobIds?: string[]
  hasTranslations: boolean
  translationProgress?: TranslationProgress
  // Pipeline-specific fields
  pipelineStatus?: PipelineStatus
  steps?: PipelineSteps
  commit?: CommitInfo
  changeCount?: ChangeCount
  automationMode?: AutomationMode
  hasErrors?: boolean
  errorCount?: number
}

export interface BatchProgress {
  completed: number
  total: number
  percentage: number
  errorCount?: number
}

export interface BatchError {
  code: string
  type: string
  message: string
  count: number
}

export interface Batch {
  batchId: string
  senderId: string
  repositoryName?: string
  status: BatchStatus
  jobType: JobType
  sourceLocale: string
  targetLocales: string[]
  types: ('content' | 'global' | 'page')[]
  requestCount: number
  errorCount?: number
  progress?: BatchProgress
  openAiBatchId?: string
  openAiStatus?: string
  model: string
  provider: string
  createdAt: string
  submittedAt?: string
  completedAt?: string
  estimatedCompletionTime?: string
  hasOutput: boolean
  hasErrors: boolean
  errorFileName?: string
  outputProcessed: boolean
}

export interface TranslationFileStatus {
  content: { count: number; expected: number }
  global: { count: number; expected: number }
  page: { count: number; expected: number }
}

export interface TranslationSession {
  senderId: string
  sessionType: SessionType
  translationType: TranslationType
  repositoryName?: string
  sourceLocale: string
  targetLocales: string[]
  matrix: {
    [locale: string]: TranslationFileStatus & { percentage: number }
  }
  summary: {
    total: number
    completed: number
    missing: number
    percentage: number
  }
  translationPath?: string
  lastUpdated: string
}

export interface GitHubSession {
  senderId: string
  sessionType: SessionType
  repositoryName?: string
  repository: { owner: string; name: string; baseBranch: string }
  sourceLocale: string
  availableLocales: string[]
  completedLocales: string[]
  fileCount: FileCount
  hasPullRequest: boolean
  pullRequestNumber?: number
  pullRequestUrl?: string
  translationProgress?: {
    completed: number
    total: number
    files: number
  }
}

export interface SystemStats {
  tmpDirectory: {
    size: number
    uploadCount: number
    batchCount: number
    translationCount: number
  }
  providers: {
    openai: { configured: boolean; model: string }
    anthropic: { configured: boolean; model: string }
    deepseek: { configured: boolean; model: string }
  }
  github: {
    configured: boolean
    apiUrl: string
  }
}

export interface FileInfo {
  name: string
  size: number
  path: string
  lastModified: string
}

export interface Pagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

// API Response types
export interface UploadsResponse {
  uploads: Upload[]
  pagination: Pagination
}

export interface UploadDetailResponse {
  upload: Upload
  files: Record<string, FileInfo[]>
  batches: Batch[]
  translations: TranslationSession | null
}

export interface BatchesResponse {
  batches: Batch[]
  pagination: Pagination
}

export interface BatchDetailResponse {
  batch: Batch
  files: {
    input: { exists: boolean; path: string }
    output: { exists: boolean; path: string }
    manifest: { exists: boolean; path: string }
    error: { exists: boolean; path: string; errorCount?: number }
  }
  uniqueErrors?: BatchError[]
}

export interface TranslationsResponse {
  translations: TranslationSession[]
  pagination: Pagination
}

export interface GitHubReadyResponse {
  sessions: GitHubSession[]
}

export interface LocalesResponse {
  locales: string[]
  default: string
}

// Request types
export interface TriggerTranslationRequest {
  types?: ('content' | 'global' | 'page')[]
  targetLocales?: string[]
  model?: string
  provider?: TranslationProvider
  jobType?: JobType
}

export interface CreateBatchRequest {
  types?: ('content' | 'global' | 'page')[]
  targetLocales?: string[]
  model?: string
}

export interface ProcessBatchRequest {
  batchOutputId: string
}

export interface RetryBatchRequest {
  errorFileName?: string
  model?: string
}

export interface FinalizeGitHubRequest {
  targetLocales?: string[]
  dryRun?: boolean
  metadata?: {
    repository?: {
      owner: string
      name: string
      baseBranch: string
      baseCommitSha: string
    }
    issue?: {
      title?: string
      body?: string
    }
    pullRequest?: {
      title?: string
      body?: string
      baseBranch?: string
    }
    branch?: {
      name?: string
      prefix?: string
    }
  }
}

// Auth types
export interface AuthCheckResponse {
  authRequired: boolean
  authenticated: boolean
}

export interface AuthValidateResponse {
  valid: boolean
  message: string
}

// Changes types
export type ChangeStatus = PipelineStatus // Alias for backward compatibility
export type ChangeType = 'added' | 'modified' | 'deleted'

export interface FileChange {
  path: string
  type: 'content' | 'global' | 'page'
  changeType: ChangeType
  size?: number
  relativePath?: string
}

// Reuse PipelineSteps defined above
export type ChangeSessionSteps = PipelineSteps & {
  // completed step maps to outputReceived + translationsProcessed
  completed: StepStatus & { translationCount?: number }
}

export interface ChangeSession {
  sessionId: string
  repositoryName: string
  repository: {
    owner: string
    name: string
    baseBranch: string
  }
  commit: CommitInfo
  status: PipelineStatus
  automationMode: AutomationMode
  sourceLocale: string
  targetLocales: string[]
  changes?: FileChange[]
  changeCount: ChangeCount
  progress: {
    current: number
    total: number
    percentage: number
  }
  steps: ChangeSessionSteps
  batchId?: string
  pullRequestNumber?: number
  pullRequestUrl?: string
  deletionPullRequest?: {
    number: number
    url: string
  }
  hasErrors: boolean
  errorCount: number
  errors?: Array<{
    step: string
    message: string
    timestamp: string
  }>
  createdAt: string
  updatedAt: string
}

export interface ChangesResponse {
  changes: ChangeSession[]
  pagination: Pagination
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

export interface ConfigValue {
  key: string
  value: unknown
  isSensitive: boolean
  maskedPreview?: string
  updatedAt: string
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextLength?: number
  description?: string
  pricing?: {
    prompt?: string
    completion?: string
  }
}

export interface ConfigStatus {
  mockModeEnabled: boolean
  currentProvider: TranslationProvider | null
  defaultModel: string | null
  configuredProviders: {
    openai: boolean
    anthropic: boolean
    deepseek: boolean
    openrouter: boolean
  }
}

export interface ConfigsResponse {
  success: boolean
  configs: ConfigValue[]
  grouped: {
    general: ConfigValue[]
    provider: ConfigValue[]
    openai: ConfigValue[]
    anthropic: ConfigValue[]
    deepseek: ConfigValue[]
    openrouter: ConfigValue[]
  }
  error?: string
}

export interface ConfigStatusResponse {
  success: boolean
  status: ConfigStatus
  error?: string
}

export interface ModelsResponse {
  success: boolean
  models: ModelInfo[]
  provider: string
  error?: string
}
