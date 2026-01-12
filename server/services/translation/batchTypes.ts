/**
 * Shared Batch Types
 * Common types and interfaces used by batch processing services (OpenAI, Anthropic)
 */
import type { TranslationFileType } from '../../types'

export type BatchProvider = 'openai' | 'anthropic'
export type BatchTranslationType = TranslationFileType
export type BatchRequestFormat = 'markdown' | 'json'
export type BatchStatus = 'draft' | 'submitted' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface BatchRequestRecord {
  customId: string
  type: BatchTranslationType
  format: BatchRequestFormat
  relativePath: string
  sourceLocale: string
  targetLocale: string
  folderPath?: string
  fileName: string
  size: number
}

export interface BatchManifest {
  batchId: string
  senderId: string
  provider: BatchProvider
  types: BatchTranslationType[]
  sourceLocale: string
  targetLocales: string[]
  model: string
  totalRequests: number
  files: BatchRequestRecord[]
  status: BatchStatus
  createdAt: string
  updatedAt: string
  // Provider-specific metadata
  openai?: {
    inputFileId?: string
    batchId?: string
    endpoint?: string
    status?: string
    submissionTimestamp?: string
  }
  anthropic?: {
    batchId?: string
    status?: string
    submissionTimestamp?: string
    processingStatus?: string
    resultsUrl?: string
  }
}

export interface CreateBatchOptions {
  senderId: string
  sourceLocale: string
  targetLocales?: string[] | 'all'
  includeFiles?: string[] | 'all'
  types?: BatchTranslationType[] | 'all'
  provider?: BatchProvider
}

export interface CreateBatchResult {
  batchId: string
  requestCount: number
  manifest: BatchManifest
  inputFilePath: string
  provider: BatchProvider
}

export interface SubmitBatchOptions {
  senderId: string
  batchId: string
  metadata?: Record<string, string>
}

export interface SubmitBatchResult {
  batchId: string
  providerBatchId: string
  providerStatus: string
  provider: BatchProvider
}

export interface CheckBatchStatusOptions {
  senderId: string
  batchId: string
}

export interface CheckBatchStatusResult {
  batchId: string
  providerBatchId: string
  status: string
  provider: BatchProvider
  requestCounts?: {
    total: number
    completed: number
    failed: number
    processing?: number
    cancelled?: number
    expired?: number
  }
  resultsUrl?: string
}

export interface BatchSourceFile {
  type: BatchTranslationType
  format: BatchRequestFormat
  folderPath?: string
  filePath: string
  relativePath: string
  fileName: string
  size: number
}

/**
 * Common helper to normalize descriptor paths
 */
export function normalizeDescriptor(value: string): string {
  return value.replace(/\\+/g, '/').replace(/^\/+/, '').trim()
}

/**
 * Check if a file should be included in the batch
 */
export function shouldIncludeFile(
  type: BatchTranslationType,
  relativePath: string,
  includeFiles?: string[] | 'all'
): boolean {
  if (!includeFiles || includeFiles === 'all' || includeFiles.length === 0) {
    return true
  }
  const normalizedRelative = normalizeDescriptor(relativePath)
  const candidates = new Set([
    normalizedRelative,
    `${type}/${normalizedRelative}`,
    `${type}:${normalizedRelative}`
  ])

  return includeFiles.some((entry) => {
    const trimmed = typeof entry === 'string' ? entry.trim() : String(entry)
    if (candidates.has(trimmed)) {
      return true
    }
    return candidates.has(normalizeDescriptor(trimmed))
  })
}
