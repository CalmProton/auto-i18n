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