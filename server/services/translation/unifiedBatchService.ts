/**
 * Unified Batch Service
 * Routes batch operations to the appropriate provider (OpenAI or Anthropic)
 */
import { getTranslationConfig } from '../../config/env'
import { createScopedLogger } from '../../utils/logger'
import { readBatchFile, batchFileExists } from '../../utils/batchStorage'
import type {
  BatchProvider,
  BatchManifest,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult
} from './batchTypes'

// Import provider-specific services
import * as openaiService from './openaiBatchService'
import * as anthropicService from './anthropicBatchService'

const log = createScopedLogger('translation:unifiedBatch')

const MANIFEST_FILE_NAME = 'manifest.json'

/**
 * Determine the batch provider from configuration or explicit override
 */
export function getBatchProvider(explicitProvider?: BatchProvider): BatchProvider {
  if (explicitProvider) {
    return explicitProvider
  }

  const config = getTranslationConfig()

  // Check if the current provider supports batch processing
  if (config.provider === 'openai' && config.providerConfig) {
    return 'openai'
  }

  if (config.provider === 'anthropic' && config.providerConfig) {
    return 'anthropic'
  }

  // Check if any provider is available for batch processing
  if (config.providers.openai) {
    return 'openai'
  }

  if (config.providers.anthropic) {
    return 'anthropic'
  }

  throw new Error('No batch-capable provider configured. Please configure OpenAI or Anthropic API keys.')
}

/**
 * Load manifest and determine provider from an existing batch
 */
export function getProviderFromBatch(senderId: string, batchId: string): BatchProvider {
  if (!batchFileExists(senderId, batchId, MANIFEST_FILE_NAME)) {
    throw new Error(`Batch ${batchId} not found for sender ${senderId}`)
  }

  const manifestContent = readBatchFile(senderId, batchId, MANIFEST_FILE_NAME)
  const manifest = JSON.parse(manifestContent) as BatchManifest

  // Check manifest for provider
  if (manifest.provider) {
    return manifest.provider
  }

  // Infer from batch ID prefix
  if (batchId.startsWith('batch_anthropic_')) {
    return 'anthropic'
  }

  // Check for provider-specific metadata
  if (manifest.anthropic?.batchId) {
    return 'anthropic'
  }

  if (manifest.openai?.batchId) {
    return 'openai'
  }

  // Default to OpenAI for backwards compatibility
  return 'openai'
}

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
      // OpenAI service returns a slightly different result, normalize it
      const result = await openaiService.createBatch(options)
      const normalizedManifest: BatchManifest = {
        ...result.manifest,
        provider: 'openai'
      }
      return {
        batchId: result.batchId,
        requestCount: result.requestCount,
        inputFilePath: result.inputFilePath,
        provider: 'openai',
        manifest: normalizedManifest
      }
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
      // OpenAI service returns a slightly different result, normalize it
      const result = await openaiService.submitBatch(options)
      return {
        batchId: result.batchId,
        providerBatchId: result.openaiBatchId,
        providerStatus: result.openaiStatus,
        provider: 'openai'
      }
  }
}

/**
 * Check the status of a batch with the appropriate provider
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
      // OpenAI service returns a slightly different result, normalize it
      const result = await openaiService.checkBatchStatus(options)
      return {
        batchId: result.batchId,
        providerBatchId: result.openaiBatchId,
        status: result.status,
        provider: 'openai',
        requestCounts: result.requestCounts
          ? {
              total: result.requestCounts.total,
              completed: result.requestCounts.completed,
              failed: result.requestCounts.failed
            }
          : undefined
      }
  }
}

/**
 * Cancel a batch (Anthropic only)
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
export type { BatchProvider, BatchManifest, CreateBatchResult, SubmitBatchResult, CheckBatchStatusResult }
