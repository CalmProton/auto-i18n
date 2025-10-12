export interface FileUploadResponse {
  message: string
  senderId?: string
  locale?: string
  folderName?: string
  filesProcessed?: number
  files?: Array<{ name: string; size: number; folder?: string; relativePath?: string }>
  file?: { name: string; size: number }
  folders?: Array<{ name: string; fileCount: number }>
  savedFiles?: SavedFileInfo[]
  translatedFiles?: SavedFileInfo[]
  translationPending?: boolean
}

export interface ErrorResponse {
  error: string
}

export interface ProcessingResult {
  success: boolean
  message: string
  processedCount?: number
  senderId?: string
  locale?: string
  folderName?: string
  folderSummary?: Array<{ name: string; fileCount: number }>
  savedFiles?: SavedFileInfo[]
  translatedFiles?: SavedFileInfo[]
  statusCode?: number
}

export type FileType = 'content' | 'global' | 'page'

export interface ValidatedFile {
  file: File
  type: FileType
  locale: string
  senderId: string
  folderName?: string
  originalPath?: string
}

export interface SavedFileInfo {
  name: string
  size: number
  path: string
  folder?: string
  type: FileType
}

export type TranslationFileType = FileType

export interface TranslationFileDescriptor {
  type: TranslationFileType
  /** Relative path to the source file stored under tmp/<senderId>/uploads/<sourceLocale>/<type> */
  sourceTempRelativePath: string
  /** Path to the source file in the upstream repository */
  repositorySourcePath: string
  /** Optional explicit pattern for generating target repository paths (use :locale placeholder). */
  targetPathPattern?: string
  /** Optional explicit pattern for locating translated files in tmp (use :locale placeholder). */
  translationTempPathPattern?: string
  /** Optional human friendly label for logs. */
  label?: string
}

export interface TranslationRepositoryMetadata {
  owner: string
  name: string
  baseBranch: string
  baseCommitSha: string
}

export interface TranslationIssueMetadata {
  title?: string
  body?: string
}

export interface TranslationPullRequestMetadata {
  title?: string
  body?: string
  baseBranch?: string
}

export interface TranslationBranchMetadata {
  name?: string
  prefix?: string
}

export interface TranslationJobMetadata {
  id: string
  type?: string
  files: TranslationFileDescriptor[]
  sourceLocale?: string
  targetLocales?: string[]
  issue?: TranslationIssueMetadata
  pullRequest?: TranslationPullRequestMetadata
  branch?: TranslationBranchMetadata
  createdAt?: string
  updatedAt?: string
}

export interface TranslationMetadataFile {
  senderId: string
  repository?: TranslationRepositoryMetadata
  sourceLocale?: string
  targetLocales?: string[]
  issue?: TranslationIssueMetadata
  pullRequest?: TranslationPullRequestMetadata
  branch?: TranslationBranchMetadata
  jobs: TranslationJobMetadata[]
  createdAt: string
  updatedAt: string
}

export interface TranslationMetadataUpdate {
  repository?: TranslationRepositoryMetadata
  sourceLocale?: string
  targetLocales?: string[]
  issue?: TranslationIssueMetadata
  pullRequest?: TranslationPullRequestMetadata
  branch?: TranslationBranchMetadata
  jobs?: TranslationJobMetadata[]
}

interface BaseUploadRequest {
  locale: string
  senderId: string
}

export interface ContentUploadRequest extends BaseUploadRequest {
  files: Array<{
    file: File
    folderPath: string
    relativePath: string
    fieldKey?: string
  }>
}

export interface GlobalUploadRequest extends BaseUploadRequest {
  file: File
}

export interface PageUploadRequest extends BaseUploadRequest {
  folders: Array<{
    folderName: string
    file: File
  }>
}

/**
 * Changes (Incremental Updates) Types
 */

export type ChangeType = 'added' | 'modified' | 'deleted'
export type ChangeStatus = 
  | 'uploaded' 
  | 'batch-created' 
  | 'submitted' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'pr-created'

export type AutomationMode = 'auto' | 'manual'

export interface FileChange {
  /** Path in the repository (e.g., "content/en/docs/guide.md") */
  path: string
  /** Type of file */
  type: TranslationFileType
  /** Type of change */
  changeType: ChangeType
  /** File size in bytes */
  size?: number
  /** Relative path after processing */
  relativePath?: string
}

export interface CommitInfo {
  sha: string
  shortSha: string
  message: string
  author?: string
  timestamp: string
}

export interface StepStatus {
  completed: boolean
  timestamp?: string
  error?: string
}

export interface ChangeSessionSteps {
  uploaded: StepStatus
  batchCreated: StepStatus & { batchId?: string }
  submitted: StepStatus & { openAiBatchId?: string }
  processing: StepStatus & { progress?: number }
  completed: StepStatus & { translationCount?: number }
  prCreated: StepStatus & { pullRequestNumber?: number; pullRequestUrl?: string }
}

export interface JsonDelta {
  added: Record<string, any>
  modified: Record<string, any>
  deleted: string[]
}

export interface ChangeSessionMetadata {
  sessionId: string
  status: ChangeStatus
  repository: TranslationRepositoryMetadata & {
    commitSha: string
  }
  commit: CommitInfo
  sourceLocale: string
  targetLocales: string[]
  changes: FileChange[]
  automationMode: AutomationMode
  steps: ChangeSessionSteps
  errors: Array<{
    step: string
    message: string
    timestamp: string
  }>
  deletionPullRequest?: {
    number: number
    url: string
  }
  createdAt: string
  updatedAt: string
}

export interface ChangesUploadRequest {
  sessionId: string
  repository: {
    owner: string
    name: string
    baseBranch: string
    baseCommitSha: string
    commitSha: string
    commitMessage: string
    commitAuthor?: string
  }
  sourceLocale: string
  targetLocales: string[]
  changes: Array<{
    path: string
    type: TranslationFileType
    changeType: ChangeType
  }>
  automationMode?: AutomationMode
}

export interface ChangeProcessResponse {
  sessionId: string
  status: ChangeStatus
  message: string
  batchId?: string
  error?: string
}