/**
 * Batch Service Module
 * 
 * Unified batch processing for translation jobs across multiple providers.
 * 
 * Usage:
 * ```typescript
 * import { createBatch, submitBatch, processCompletedBatch } from '../services/batch'
 * ```
 */

// Re-export unified service as the main API
export {
  // Provider detection
  getBatchProvider,
  getProviderFromBatch,
  
  // Batch operations
  createBatch,
  submitBatch,
  checkBatchStatus,
  cancelBatch,
  createRetryBatch,
  
  // Batch processing
  processCompletedBatch,
  
  // Availability
  isBatchProcessingAvailable
} from './unifiedService'

// Re-export types
export type {
  BatchProvider,
  BatchManifest,
  BatchRequestRecord,
  BatchSourceFile,
  BatchStatus,
  BatchTranslationType,
  BatchRequestFormat,
  BatchRequestCounts,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult,
  CreateRetryBatchOptions,
  CreateRetryBatchResult,
  ProcessedTranslation,
  OpenAIBatchMetadata,
  AnthropicBatchMetadata
} from './types'

// Re-export common utilities for internal use
export {
  collectContentSources,
  collectJsonSources,
  getTargetLocales,
  shouldIncludeFile,
  normalizeDescriptor,
  buildCustomId,
  parseCustomId,
  loadManifest,
  saveManifest,
  generateOpenAIBatchId,
  generateAnthropicBatchId,
  decodeUnicodeEscapes
} from './common'

// Re-export provider-specific output processors for direct use
export { processBatchOutput as processOpenAIBatchOutput } from './providers/openai/outputProcessor'
export { processBatchOutput as processAnthropicBatchOutput } from './providers/anthropic/outputProcessor'

// Re-export mock utilities
export { isMockBatch, submitMockBatch, checkMockBatchStatus } from './providers/mock'
