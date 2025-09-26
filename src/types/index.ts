export interface FileUploadResponse {
  message: string
  locale?: string
  folderName?: string
  filesProcessed?: number
  files?: Array<{ name: string; size: number; folder?: string }>
  file?: { name: string; size: number }
  folders?: Array<{ name: string; fileCount: number }>
}

export interface ErrorResponse {
  error: string
}

export interface ProcessingResult {
  success: boolean
  message: string
  processedCount?: number
  locale?: string
  folderName?: string
}

export type FileType = 'content' | 'global' | 'page'

export interface ValidatedFile {
  file: File
  type: FileType
  locale: string
  folderName?: string
  originalPath?: string
}

export interface ContentUploadRequest {
  locale: string
  folderName: string
  files: File[]
}

export interface GlobalUploadRequest {
  locale: string
  file: File
}

export interface PageUploadRequest {
  locale: string
  folders: Array<{
    folderName: string
    file: File
  }>
}