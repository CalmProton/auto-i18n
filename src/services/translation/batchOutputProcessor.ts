import { readFile } from 'node:fs/promises'
import { createScopedLogger } from '../../utils/logger'
import type { BatchManifest, BatchRequestRecord } from './openaiBatchService'
import { getBatchFilePath } from '../../utils/batchStorage'

const log = createScopedLogger('translation:batchOutputProcessor')

export interface BatchOutputLine {
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
 * Decodes Unicode escape sequences like \u0645\u062f\u0639\u0648\u0645\u0629 to proper UTF-8
 */
export function decodeUnicodeEscapes(text: string): string {
  try {
    // Replace Unicode escape sequences with actual characters
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16))
    })
  } catch (error) {
    log.warn('Failed to decode Unicode escapes', { error, textPreview: text.slice(0, 100) })
    return text
  }
}

/**
 * Parses a single line from the JSONL batch output
 */
export function parseBatchOutputLine(line: string): BatchOutputLine | null {
  try {
    const parsed = JSON.parse(line) as BatchOutputLine
    
    if (!parsed.custom_id || !parsed.response) {
      log.warn('Invalid batch output line: missing custom_id or response', { line: line.slice(0, 200) })
      return null
    }
    
    return parsed
  } catch (error) {
    log.error('Failed to parse batch output line', { error, line: line.slice(0, 200) })
    return null
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
 * Extracts translated content from a batch output line
 */
export function extractTranslatedContent(outputLine: BatchOutputLine): string | null {
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
    
    if (!content || typeof content !== 'string') {
      log.warn('No content in batch output message', { customId: outputLine.custom_id })
      return null
    }
    
    // Decode Unicode escape sequences
    return decodeUnicodeEscapes(content)
    
  } catch (error) {
    log.error('Failed to extract translated content', { 
      customId: outputLine.custom_id, 
      error 
    })
    return null
  }
}

/**
 * Processes a complete JSONL batch output file
 */
export async function processBatchOutput(options: {
  senderId: string
  batchId: string
  outputContent: string
}): Promise<ProcessedTranslation[]> {
  const { senderId, batchId, outputContent } = options
  
  log.info('Processing batch output', { senderId, batchId })
  
  // Load manifest
  const manifestPath = getBatchFilePath(senderId, batchId, 'manifest.json')
  const manifestContent = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestContent) as BatchManifest
  
  // Split into lines and parse
  const lines = outputContent.split('\n').filter(line => line.trim().length > 0)
  const results: ProcessedTranslation[] = []
  
  for (const line of lines) {
    const outputLine = parseBatchOutputLine(line)
    
    if (!outputLine) {
      continue
    }
    
    // Find matching record in manifest
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
    
    // Extract and decode content
    const translatedContent = extractTranslatedContent(outputLine)
    
    if (!translatedContent) {
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
        errorMessage: outputLine.error ? String(outputLine.error) : 'Failed to extract content'
      })
      continue
    }
    
    // Success
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
  
  log.info('Batch output processing complete', {
    senderId,
    batchId,
    totalLines: lines.length,
    successCount: results.filter(r => r.status === 'success').length,
    errorCount: results.filter(r => r.status === 'error').length
  })
  
  return results
}
