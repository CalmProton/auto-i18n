/**
 * Batch Types
 * Consolidated type definitions for batch processing across all providers
 */
import type { TranslationFileType } from '../../types'

// ============================================================================
// Core Types
// ============================================================================

export type BatchProvider = 'openai' | 'anthropic'
export type BatchTranslationType = TranslationFileType
export type BatchRequestFormat = 'markdown' | 'json'
export type BatchStatus = 'draft' | 'submitted' | 'completed' | 'failed' | 'cancelled' | 'expired'

// ============================================================================
// Batch Record Types
// ============================================================================

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

export interface BatchSourceFile {
  type: BatchTranslationType
  format: BatchRequestFormat
  folderPath?: string
  filePath: string
  relativePath: string
  fileName: string
  size: number
}

// ============================================================================
// Manifest Types
// ============================================================================

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
  openai?: OpenAIBatchMetadata
  anthropic?: AnthropicBatchMetadata
}

export interface OpenAIBatchMetadata {
  inputFileId?: string
  batchId?: string
  endpoint?: string
  status?: string
  submissionTimestamp?: string
}

export interface AnthropicBatchMetadata {
  batchId?: string
  status?: string
  submissionTimestamp?: string
  processingStatus?: string
  resultsUrl?: string
}

// ============================================================================
// Operation Options & Results
// ============================================================================

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
  requestCounts?: BatchRequestCounts
  resultsUrl?: string
  outputFileId?: string
  errorFileId?: string
}

export interface BatchRequestCounts {
  total: number
  completed: number
  failed: number
  processing?: number
  cancelled?: number
  expired?: number
}

// ============================================================================
// Processed Translation Types
// ============================================================================

export interface ProcessedTranslation {
  customId: string
  targetLocale: string
  type: string
  format: BatchRequestFormat
  relativePath: string
  folderPath?: string
  fileName: string
  translatedContent: string
  status: 'success' | 'error'
  errorMessage?: string
}

// ============================================================================
// Retry Batch Types (OpenAI only)
// ============================================================================

export interface CreateRetryBatchOptions {
  senderId: string
  originalBatchId: string
  errorFileName: string
  model?: string
}

export interface CreateRetryBatchResult {
  batchId: string
  requestCount: number
  failedRequestCount: number
  manifest: BatchManifest
  inputFilePath: string
}
