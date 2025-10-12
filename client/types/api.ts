/**
 * Frontend API Types
 * TypeScript types matching the backend API responses
 */

export type UploadStatus = 'uploaded' | 'batched' | 'translating' | 'completed'
export type BatchStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'partially_failed'
export type JobType = 'openai-batch' | 'regular-translation'
export type TranslationProvider = 'openai' | 'anthropic' | 'deepseek'

export interface DashboardOverview {
  totalUploads: number
  activeBatches: number
  completedBatches: number
  failedBatches: number
  totalTranslations: number
  pendingTranslations: number
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

export interface Upload {
  senderId: string
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
}

export interface BatchProgress {
  completed: number
  total: number
  percentage: number
  errorCount?: number
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
  lastUpdated: string
}

export interface GitHubSession {
  senderId: string
  repositoryName?: string
  repository: { owner: string; name: string; baseBranch: string }
  sourceLocale: string
  availableLocales: string[]
  completedLocales: string[]
  fileCount: FileCount
  hasPullRequest: boolean
  pullRequestNumber?: number
  pullRequestUrl?: string
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
