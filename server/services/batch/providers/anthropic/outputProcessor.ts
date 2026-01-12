/**
 * Anthropic Batch Output Processor
 * Parses JSON output from Anthropic's Message Batches API
 */
import { createScopedLogger } from '../../../../utils/logger'
import { decodeUnicodeEscapes, loadManifest } from '../../common'
import type { BatchManifest, BatchRequestRecord, ProcessedTranslation } from '../../types'

const log = createScopedLogger('batch:anthropic:output')

// ============================================================================
// Types
// ============================================================================

export interface AnthropicBatchResult {
  custom_id: string
  result: {
    type: 'succeeded' | 'errored' | 'canceled' | 'expired'
    message?: {
      id: string
      type: 'message'
      role: 'assistant'
      model: string
      content: Array<{
        type: 'text'
        text: string
      }>
      stop_reason: string
      stop_sequence: string | null
      usage: {
        input_tokens: number
        output_tokens: number
      }
    }
    error?: {
      type: string
      message: string
    }
  }
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Find a matching record in the manifest by custom_id
 */
export function findRecordByCustomId(
  manifest: BatchManifest,
  customId: string
): BatchRequestRecord | null {
  const record = manifest.files.find((file) => file.customId === customId)

  if (!record) {
    log.warn('No matching record found in manifest', {
      customId,
      manifestFiles: manifest.files.length
    })
  }

  return record ?? null
}

/**
 * Extract translated content from an Anthropic batch result
 */
export function extractTranslatedContent(result: AnthropicBatchResult): string | null {
  try {
    if (result.result.type !== 'succeeded') {
      log.warn('Non-succeeded result in batch output', {
        customId: result.custom_id,
        resultType: result.result.type,
        error: result.result.error
      })
      return null
    }

    const message = result.result.message
    if (!message) {
      log.warn('No message in succeeded result', { customId: result.custom_id })
      return null
    }

    if (message.stop_reason === 'max_tokens') {
      log.warn('Response truncated due to max tokens', {
        customId: result.custom_id,
        stopReason: message.stop_reason
      })
    }

    const textContent = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    if (!textContent || textContent.trim().length === 0) {
      log.warn('No text content in batch output message', {
        customId: result.custom_id,
        contentBlocks: message.content.length
      })
      return null
    }

    return decodeUnicodeEscapes(textContent)
  } catch (error) {
    log.error('Failed to extract translated content', {
      customId: result.custom_id,
      error
    })
    return null
  }
}

// ============================================================================
// Main Processing
// ============================================================================

/**
 * Process a complete Anthropic batch output file (JSON array)
 */
export async function processBatchOutput(options: {
  senderId: string
  batchId: string
  outputContent: string
}): Promise<ProcessedTranslation[]> {
  const { senderId, batchId, outputContent } = options

  log.info('Processing Anthropic batch output', { senderId, batchId })

  const manifest = loadManifest(senderId, batchId)

  let results: AnthropicBatchResult[]
  try {
    results = JSON.parse(outputContent)
  } catch (error) {
    log.error('Failed to parse Anthropic batch output', { senderId, batchId, error })
    throw new Error(`Failed to parse Anthropic batch output: ${error}`)
  }

  const processedResults: ProcessedTranslation[] = []

  for (const result of results) {
    const record = findRecordByCustomId(manifest, result.custom_id)
    if (!record) {
      log.warn('Skipping result with no matching record', { customId: result.custom_id })
      continue
    }

    if (result.result.type !== 'succeeded') {
      processedResults.push({
        customId: result.custom_id,
        targetLocale: record.targetLocale,
        type: record.type,
        format: record.format,
        relativePath: record.relativePath,
        folderPath: record.folderPath,
        fileName: record.fileName,
        translatedContent: '',
        status: 'error',
        errorMessage:
          result.result.error?.message ||
          `Request ${result.result.type}: ${result.result.type === 'expired' ? 'Request expired after 24 hours' : 'Unknown error'}`
      })
      continue
    }

    const translatedContent = extractTranslatedContent(result)
    if (!translatedContent) {
      processedResults.push({
        customId: result.custom_id,
        targetLocale: record.targetLocale,
        type: record.type,
        format: record.format,
        relativePath: record.relativePath,
        folderPath: record.folderPath,
        fileName: record.fileName,
        translatedContent: '',
        status: 'error',
        errorMessage: 'Failed to extract translated content'
      })
      continue
    }

    processedResults.push({
      customId: result.custom_id,
      targetLocale: record.targetLocale,
      type: record.type,
      format: record.format,
      relativePath: record.relativePath,
      folderPath: record.folderPath,
      fileName: record.fileName,
      translatedContent,
      status: 'success'
    })
  }

  const successCount = processedResults.filter((r) => r.status === 'success').length
  const errorCount = processedResults.filter((r) => r.status === 'error').length

  log.info('Anthropic batch output processing complete', {
    senderId,
    batchId,
    totalResults: results.length,
    successCount,
    errorCount
  })

  return processedResults
}
