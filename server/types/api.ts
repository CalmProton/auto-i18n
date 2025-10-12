/**
 * Dashboard API Types
 * Types for the new dashboard API endpoints
 */

export type UploadStatus = 'uploaded' | 'batched' | 'translating' | 'completed'
export type BatchStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'partially_failed'
export type JobType = 'openai-batch' | 'regular-translation'

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

export interface BatchManifest {
  batchId: string
  senderId: string
  types: ('content' | 'global' | 'page')[]
  sourceLocale: string
  targetLocales: string[]
  requestCount: number
  totalCharacters?: number
  model: string
  provider: string
  openAiFileId?: string
  openAiBatchId?: string
  submittedAt?: string
  status?: BatchStatus
  completedAt?: string
  jobType?: JobType
}

export interface BatchRequest {
  custom_id: string
  method: string
  url: string
  body: {
    model: string
    messages: Array<{ role: string; content: string }>
  }
}

export interface FailedRequest extends BatchRequest {
  error: {
    message: string
    code?: string
  }
}

export interface ProcessingError {
  locale: string
  type: string
  filename: string
  error: string
}

export interface DashboardOverview {
  totalUploads: number
  activeBatches: number
  completedBatches: number
  failedBatches: number
  totalTranslations: number
  pendingTranslations: number
  readyForPR: number
}

export interface TriggerTranslationRequest {
  types?: ('content' | 'global' | 'page')[]
  targetLocales?: string[]
  model?: string
  provider?: 'openai' | 'anthropic' | 'deepseek'
  jobType?: JobType
}

export interface CreateBatchRequest {
  types?: ('content' | 'global' | 'page')[]
  targetLocales?: string[]
  model?: string
}

export interface FinalizeGitHubRequest {
  senderId: string
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

export interface ProcessBatchOutputResponse {
  success: boolean
  savedFiles: number
  failedFiles: number
  summary: {
    byLocale: Record<string, number>
    byType: Record<string, number>
  }
  errors?: ProcessingError[]
}

export interface ExportTranslationsRequest {
  senderId: string
  locales?: string[]
  types?: ('content' | 'global' | 'page')[]
  format?: 'zip' | 'json'
}

/**
 * Changes Dashboard API Types
 */

export interface ChangeSession {
  sessionId: string
  repositoryName: string
  repository: {
    owner: string
    name: string
    baseBranch: string
  }
  commit: {
    sha: string
    shortSha: string
    message: string
    author?: string
    timestamp: string
  }
  status: import('./index').ChangeStatus
  automationMode: import('./index').AutomationMode
  sourceLocale: string
  targetLocales: string[]
  changeCount: {
    added: number
    modified: number
    deleted: number
    total: number
  }
  progress: {
    current: number
    total: number
    percentage: number
  }
  steps: import('./index').ChangeSessionSteps
  batchId?: string
  pullRequestNumber?: number
  pullRequestUrl?: string
  deletionPullRequest?: {
    number: number
    url: string
  }
  hasErrors: boolean
  errorCount: number
  createdAt: string
  updatedAt: string
}
