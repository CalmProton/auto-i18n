/**
 * Unified Batch Service
 * Routes batch operations to the appropriate provider (OpenAI or Anthropic)
 * and provides a unified interface for all batch operations.
 */
import { getTranslationConfig } from '../../config/env'
import { createScopedLogger } from '../../utils/logger'
import { batchFileExists, readBatchFile } from '../../utils/batchStorage'
import { loadManifest } from './common'
import type {
  BatchProvider,
  BatchManifest,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult,
  CreateRetryBatchOptions,
  CreateRetryBatchResult,
  ProcessedTranslation
} from './types'

// Import provider services
import * as openaiService from './providers/openai/service'
import * as anthropicService from './providers/anthropic/service'
import { processBatchOutput as processOpenAIOutput } from './providers/openai/outputProcessor'
import { processBatchOutput as processAnthropicOutput } from './providers/anthropic/outputProcessor'

const log = createScopedLogger('batch:unified')

const MANIFEST_FILE_NAME = 'manifest.json'

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Determine the batch provider from configuration or explicit override
 */
export function getBatchProvider(explicitProvider?: BatchProvider): BatchProvider {
  if (explicitProvider) {
    return explicitProvider
  }

  const config = getTranslationConfig()

  // Check if current provider supports batch
  if (config.provider === 'openai' && config.providerConfig) {
    return 'openai'
  }

  if (config.provider === 'anthropic' && config.providerConfig) {
    return 'anthropic'
  }

  // Check available providers
  if (config.providers.openai) {
    return 'openai'
  }

  if (config.providers.anthropic) {
    return 'anthropic'
  }

  throw new Error('No batch-capable provider configured. Please configure OpenAI or Anthropic API keys.')
}

/**
 * Determine provider from an existing batch
 */
export function getProviderFromBatch(senderId: string, batchId: string): BatchProvider {
  if (!batchFileExists(senderId, batchId, MANIFEST_FILE_NAME)) {
    throw new Error(`Batch ${batchId} not found for sender ${senderId}`)
  }

  const manifestContent = readBatchFile(senderId, batchId, MANIFEST_FILE_NAME)
  const manifest = JSON.parse(manifestContent) as BatchManifest

  // Explicit provider in manifest
  if (manifest.provider) {
    return manifest.provider
  }

  // Infer from batch ID
  if (batchId.startsWith('batch_anthropic_')) {
    return 'anthropic'
  }

  // Check provider-specific metadata
  if (manifest.anthropic?.batchId) {
    return 'anthropic'
  }

  if (manifest.openai?.batchId) {
    return 'openai'
  }

  // Default for backwards compatibility
  return 'openai'
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Create a batch using the appropriate provider
 */
export async function createBatch(options: CreateBatchOptions): Promise<CreateBatchResult> {
  const provider = getBatchProvider(options.provider)

  log.info('Creating batch', {
    provider,
    senderId: options.senderId,
    sourceLocale: options.sourceLocale
  })

  switch (provider) {
    case 'anthropic':
      return anthropicService.createBatch(options)
    case 'openai':
    default:
      return openaiService.createBatch(options)
  }
}

/**
 * Submit a batch to the appropriate provider
 */
export async function submitBatch(options: SubmitBatchOptions): Promise<SubmitBatchResult> {
  const provider = getProviderFromBatch(options.senderId, options.batchId)

  log.info('Submitting batch', {
    provider,
    senderId: options.senderId,
    batchId: options.batchId
  })

  switch (provider) {
    case 'anthropic':
      return anthropicService.submitBatch(options)
    case 'openai':
    default:
      return openaiService.submitBatch(options)
  }
}

/**
 * Check the status of a batch
 */
export async function checkBatchStatus(options: CheckBatchStatusOptions): Promise<CheckBatchStatusResult> {
  const provider = getProviderFromBatch(options.senderId, options.batchId)

  log.debug('Checking batch status', {
    provider,
    senderId: options.senderId,
    batchId: options.batchId
  })

  switch (provider) {
    case 'anthropic':
      return anthropicService.checkBatchStatus(options)
    case 'openai':
    default:
      return openaiService.checkBatchStatus(options)
  }
}

/**
 * Cancel a batch (Anthropic only for now)
 */
export async function cancelBatch(options: CheckBatchStatusOptions): Promise<CheckBatchStatusResult> {
  const provider = getProviderFromBatch(options.senderId, options.batchId)

  log.info('Cancelling batch', {
    provider,
    senderId: options.senderId,
    batchId: options.batchId
  })

  switch (provider) {
    case 'anthropic':
      return anthropicService.cancelBatch(options)
    case 'openai':
    default:
      throw new Error('OpenAI batch cancellation is not yet implemented')
  }
}

/**
 * Create a retry batch from failed requests (OpenAI only)
 */
export async function createRetryBatch(options: CreateRetryBatchOptions): Promise<CreateRetryBatchResult> {
  // Retry is OpenAI-specific for now
  return openaiService.createRetryBatch(options)
}

// ============================================================================
// Batch Processing
// ============================================================================

export interface ProcessCompletedBatchOptions {
  senderId: string
  batchId: string
}

export interface ProcessCompletedBatchResult {
  provider: BatchProvider
  translations: ProcessedTranslation[]
  successCount: number
  errorCount: number
}

/**
 * Process completed batch output - unified entry point for workers
 * 
 * This method handles:
 * 1. Determining the provider from the batch
 * 2. Finding and reading the output file
 * 3. Processing output with the appropriate provider processor
 */
export async function processCompletedBatch(
  options: ProcessCompletedBatchOptions
): Promise<ProcessCompletedBatchResult> {
  const { senderId, batchId } = options
  const provider = getProviderFromBatch(senderId, batchId)
  const manifest = loadManifest(senderId, batchId)

  log.info('Processing completed batch', { senderId, batchId, provider })

  let outputContent: string
  let translations: ProcessedTranslation[]

  if (provider === 'anthropic') {
    const anthropicBatchId = manifest.anthropic?.batchId
    if (!anthropicBatchId) {
      throw new Error(`Batch ${batchId} has no Anthropic batch ID`)
    }

    const outputFileName = `${anthropicBatchId}_output.json`
    if (!batchFileExists(senderId, batchId, outputFileName)) {
      throw new Error(`Batch ${batchId} has no output file: ${outputFileName}`)
    }

    outputContent = readBatchFile(senderId, batchId, outputFileName)
    translations = await processAnthropicOutput({ senderId, batchId, outputContent })
  } else {
    const openaiBatchId = manifest.openai?.batchId
    if (!openaiBatchId) {
      throw new Error(`Batch ${batchId} has no OpenAI batch ID`)
    }

    const outputFileName = `${openaiBatchId}_output.jsonl`
    if (!batchFileExists(senderId, batchId, outputFileName)) {
      throw new Error(`Batch ${batchId} has no output file: ${outputFileName}`)
    }

    outputContent = readBatchFile(senderId, batchId, outputFileName)
    translations = await processOpenAIOutput({ senderId, batchId, outputContent })
  }

  const successCount = translations.filter((t) => t.status === 'success').length
  const errorCount = translations.filter((t) => t.status === 'error').length

  log.info('Batch processing complete', {
    senderId,
    batchId,
    provider,
    successCount,
    errorCount
  })

  return {
    provider,
    translations,
    successCount,
    errorCount
  }
}

// ============================================================================
// Availability Check
// ============================================================================

/**
 * Check if batch processing is available
 */
export function isBatchProcessingAvailable(): { available: boolean; providers: BatchProvider[] } {
  const config = getTranslationConfig()
  const providers: BatchProvider[] = []

  if (config.providers.openai || (config.provider === 'openai' && config.providerConfig)) {
    providers.push('openai')
  }

  if (config.providers.anthropic || (config.provider === 'anthropic' && config.providerConfig)) {
    providers.push('anthropic')
  }

  return {
    available: providers.length > 0,
    providers
  }
}

// Re-export types
export type {
  BatchProvider,
  BatchManifest,
  BatchRequestRecord,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult,
  CreateRetryBatchOptions,
  CreateRetryBatchResult,
  ProcessedTranslation
} from './types'
