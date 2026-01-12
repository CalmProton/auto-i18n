/**
 * Anthropic Batch Output Processor
 * Processes results from Anthropic's Message Batches API
 */
import { readFile } from 'node:fs/promises'
import { createScopedLogger } from '../../utils/logger'
import { getBatchFilePath } from '../../utils/batchStorage'
import type { BatchManifest, BatchRequestRecord } from './batchTypes'

const log = createScopedLogger('translation:anthropicBatchOutputProcessor')

/**
 * Anthropic batch result types
 */
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

export interface ProcessedTranslation {
  customId: string
  targetLocale: string
  type: string
  format: 'markdown' | 'json'
  relativePath: string
  folderPath?: string
  fileName: string
  translatedContent: string
  status: 'success' | 'error'
  errorMessage?: string
}

/**
 * Decodes Unicode escape sequences to proper UTF-8
 */
export function decodeUnicodeEscapes(text: string): string {
  try {
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16))
    })
  } catch (error) {
    log.warn('Failed to decode Unicode escapes', { error, textPreview: text.slice(0, 100) })
    return text
  }
}

/**
 * Extracts custom_id metadata parts (format, type, locale, hash, path)
 * Format: {format}_{type}_{locale}_{hash}_{pathFragment}
 */
export function parseCustomId(customId: string): {
  format: 'markdown' | 'json'
  type: string
  targetLocale: string
  hash: string
  pathFragment: string
} | null {
  const parts = customId.split('_')

  if (parts.length < 5) {
    log.warn('Invalid custom_id format', { customId })
    return null
  }

  const [format, type, targetLocale, hash, ...pathFragments] = parts

  if (!['markdown', 'json'].includes(format)) {
    log.warn('Invalid format in custom_id', { customId, format })
    return null
  }

  return {
    format: format as 'markdown' | 'json',
    type,
    targetLocale,
    hash,
    pathFragment: pathFragments.join('_')
  }
}

/**
 * Finds the matching BatchRequestRecord from manifest using custom_id
 */
export function findRecordByCustomId(
  manifest: BatchManifest,
  customId: string
): BatchRequestRecord | null {
  const record = manifest.files.find((file) => file.customId === customId)

  if (!record) {
    log.warn('No matching record found in manifest', { customId, manifestFiles: manifest.files.length })
  }

  return record ?? null
}

/**
 * Extracts translated content from an Anthropic batch result
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

    // Decode Unicode escape sequences
    return decodeUnicodeEscapes(textContent)
  } catch (error) {
    log.error('Failed to extract translated content', {
      customId: result.custom_id,
      error
    })
    return null
  }
}

/**
 * Processes a complete Anthropic batch output file
 */
export async function processBatchOutput(options: {
  senderId: string
  batchId: string
  outputContent: string
}): Promise<ProcessedTranslation[]> {
  const { senderId, batchId, outputContent } = options

  log.info('Processing Anthropic batch output', { senderId, batchId })

  // Load manifest
  const manifestPath = getBatchFilePath(senderId, batchId, 'manifest.json')
  const manifestContent = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestContent) as BatchManifest

  // Parse results (Anthropic returns JSON array, not JSONL)
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

  log.info('Finished processing Anthropic batch output', {
    senderId,
    batchId,
    totalResults: results.length,
    successCount,
    errorCount
  })

  return processedResults
}
