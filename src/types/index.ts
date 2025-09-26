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