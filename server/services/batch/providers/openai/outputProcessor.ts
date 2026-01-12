/**
 * OpenAI Batch Output Processor
 * Parses JSONL output from OpenAI's Batch API
 */
import { readFile } from 'node:fs/promises'
import { getBatchFilePath } from '../../../../utils/batchStorage'
import { createScopedLogger } from '../../../../utils/logger'
import { decodeUnicodeEscapes, parseCustomId, loadManifest } from '../../common'
import type { BatchManifest, BatchRequestRecord, ProcessedTranslation } from '../../types'

const log = createScopedLogger('batch:openai:output')

// ============================================================================
// Types
// ============================================================================

export interface OpenAIBatchOutputLine {
  id: string
  custom_id: string
  response: {
    status_code: number
    request_id: string
    body: {
      id: string
      object: string
      created: number
      model: string
      choices: Array<{
        index: number
        message: {
          role: string
          content: string
          refusal: string | null
        }
        finish_reason: string
      }>
      usage: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
    }
  }
  error: unknown | null
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a single line from the JSONL batch output
 */
export function parseBatchOutputLine(line: string): OpenAIBatchOutputLine | null {
  try {
    const parsed = JSON.parse(line) as OpenAIBatchOutputLine

    if (!parsed.custom_id || !parsed.response) {
      log.warn('Invalid batch output line: missing custom_id or response', { 
        line: line.slice(0, 200) 
      })
      return null
    }

    return parsed
  } catch (error) {
    log.error('Failed to parse batch output line', { error, line: line.slice(0, 200) })
    return null
  }
}

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
 * Extract translated content from a batch output line
 */
export function extractTranslatedContent(outputLine: OpenAIBatchOutputLine): string | null {
  try {
    const { response } = outputLine

    if (response.status_code !== 200) {
      log.warn('Non-200 status code in batch output', {
        customId: outputLine.custom_id,
        statusCode: response.status_code
      })
      return null
    }

    if (!response.body.choices || response.body.choices.length === 0) {
      log.warn('No choices in batch output', { customId: outputLine.custom_id })
      return null
    }

    const content = response.body.choices[0]?.message?.content
    const finishReason = response.body.choices[0]?.finish_reason

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      log.warn('No content in batch output message', {
        customId: outputLine.custom_id,
        finishReason,
        contentLength: content?.length || 0
      })
      return null
    }

    return decodeUnicodeEscapes(content)
  } catch (error) {
    log.error('Failed to extract translated content', {
      customId: outputLine.custom_id,
      error
    })
    return null
  }
}

// ============================================================================
// Main Processing
// ============================================================================

/**
 * Process a complete JSONL batch output file
 */
export async function processBatchOutput(options: {
  senderId: string
  batchId: string
  outputContent: string
}): Promise<ProcessedTranslation[]> {
  const { senderId, batchId, outputContent } = options

  log.info('Processing OpenAI batch output', { senderId, batchId })

  const manifest = loadManifest(senderId, batchId)
  const lines = outputContent.split('\n').filter((line) => line.trim().length > 0)
  const results: ProcessedTranslation[] = []

  for (const line of lines) {
    const outputLine = parseBatchOutputLine(line)

    if (!outputLine) {
      continue
    }

    const record = findRecordByCustomId(manifest, outputLine.custom_id)

    if (!record) {
      results.push({
        customId: outputLine.custom_id,
        targetLocale: 'unknown',
        type: 'unknown',
        format: 'markdown',
        relativePath: '',
        fileName: '',
        translatedContent: '',
        status: 'error',
        errorMessage: 'No matching record in manifest'
      })
      continue
    }

    const translatedContent = extractTranslatedContent(outputLine)
    const finishReason = outputLine.response?.body?.choices?.[0]?.finish_reason

    if (!translatedContent) {
      let errorMessage = 'Failed to extract content'

      if (finishReason === 'length') {
        errorMessage = 'Content truncated - exceeded token limit'
      } else if (outputLine.error) {
        errorMessage = String(outputLine.error)
      }

      results.push({
        customId: outputLine.custom_id,
        targetLocale: record.targetLocale,
        type: record.type,
        format: record.format,
        relativePath: record.relativePath,
        folderPath: record.folderPath,
        fileName: record.fileName,
        translatedContent: '',
        status: 'error',
        errorMessage
      })
      continue
    }

    results.push({
      customId: outputLine.custom_id,
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

  const successCount = results.filter((r) => r.status === 'success').length
  const errorCount = results.filter((r) => r.status === 'error').length

  log.info('OpenAI batch output processing complete', {
    senderId,
    batchId,
    totalLines: lines.length,
    successCount,
    errorCount
  })

  return results
}

// Re-export for convenience
export { parseCustomId }
