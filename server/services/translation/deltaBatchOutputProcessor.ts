/**
 * Process OpenAI batch output for delta-based translations
 * Parses batch results and merges translated deltas into translation files
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createScopedLogger } from '../../utils/logger'
import { getBatchFilePath, batchFileExists, readBatchFile } from '../../utils/batchStorage'
import type { BatchManifest } from './openaiBatchService'
import type { JsonDelta } from '../../types'

const log = createScopedLogger('services:deltaBatchOutputProcessor')

const TMP_DIR = join(process.cwd(), 'tmp')
const MANIFEST_FILE_NAME = 'manifest.json'

/**
 * Load batch manifest
 */
function loadManifest(senderId: string, batchId: string): BatchManifest {
  const content = readBatchFile(senderId, batchId, MANIFEST_FILE_NAME)
  const manifest = JSON.parse(content) as BatchManifest
  return manifest
}

interface BatchOutputLine {
  id: string
  custom_id: string
  response: {
    status_code: number
    body: {
      choices: Array<{
        message: {
          content: string
        }
      }>
    }
  }
  error: unknown | null
}

interface ProcessedDelta {
  customId: string
  targetLocale: string
  fileName: string
  filePath: string
  status: 'success' | 'error'
  errorMessage?: string
  translatedKeysCount?: number
}

export interface ProcessDeltaBatchResult {
  sessionId: string
  batchId: string
  processedCount: number
  errorCount: number
  deltas: ProcessedDelta[]
  translationsByLocale: Record<string, number>
}

/**
 * Parse custom_id to extract sessionId, targetLocale, and fileName
 * Format: {sessionId}_{targetLocale}_{fileName}
 */
function parseCustomId(customId: string): { sessionId: string; targetLocale: string; fileName: string } | null {
  const parts = customId.split('_')
  
  if (parts.length < 3) {
    return null
  }

  // The fileName might contain underscores, so we need to reconstruct it
  // Format is: sessionId_locale_filename.delta.json
  const sessionId = parts[0]
  const targetLocale = parts[1]
  const fileName = parts.slice(2).join('_')

  return { sessionId, targetLocale, fileName }
}

/**
 * Load original file from change session
 */
function loadOriginalFile(sessionId: string, fileName: string): Record<string, any> | null {
  // Remove .delta.json suffix to get original filename
  const originalFileName = fileName.replace('.delta.json', '.json')
  const originalPath = join(TMP_DIR, sessionId, 'changes', 'original', originalFileName)

  if (!existsSync(originalPath)) {
    log.warn('Original file not found', { sessionId, fileName: originalFileName, originalPath })
    return null
  }

  try {
    const content = readFileSync(originalPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    log.error('Failed to load original file', { sessionId, fileName: originalFileName, error })
    return null
  }
}

/**
 * Merge translated delta into original file
 */
function mergeTranslatedDelta(
  original: Record<string, any>,
  translatedDelta: Record<string, any>
): Record<string, any> {
  // Create a copy of the original
  const merged = { ...original }

  // Apply all translated keys from the delta
  for (const [key, value] of Object.entries(translatedDelta)) {
    merged[key] = value
  }

  return merged
}

/**
 * Save merged translation file
 */
function saveTranslationFile(
  sessionId: string,
  targetLocale: string,
  fileName: string,
  content: Record<string, any>
): void {
  // Remove .delta.json suffix to get original filename
  const originalFileName = fileName.replace('.delta.json', '.json')
  
  // Determine file type from path in original structure
  // For now, assume global type (JSON files)
  const outputPath = join(TMP_DIR, sessionId, 'translations', targetLocale, 'global', originalFileName)
  
  // Create directory if needed
  const outputDir = dirname(outputPath)
  mkdirSync(outputDir, { recursive: true })

  // Write file
  writeFileSync(outputPath, JSON.stringify(content, null, 2), 'utf-8')
  
  log.debug('Saved translation file', { sessionId, targetLocale, fileName: originalFileName, outputPath })
}

/**
 * Process a single batch output line
 */
function processBatchOutputLine(
  line: string,
  sessionId: string
): ProcessedDelta | null {
  try {
    const output = JSON.parse(line) as BatchOutputLine

    // Check for errors
    if (output.error) {
      log.error('Batch line contains error', { customId: output.custom_id, error: output.error })
      
      const parsed = parseCustomId(output.custom_id)
      if (!parsed) {
        return null
      }

      return {
        customId: output.custom_id,
        targetLocale: parsed.targetLocale,
        fileName: parsed.fileName,
        filePath: '',
        status: 'error',
        errorMessage: JSON.stringify(output.error)
      }
    }

    // Parse custom_id
    const parsed = parseCustomId(output.custom_id)
    if (!parsed) {
      log.error('Failed to parse custom_id', { customId: output.custom_id })
      return {
        customId: output.custom_id,
        targetLocale: 'unknown',
        fileName: 'unknown',
        filePath: '',
        status: 'error',
        errorMessage: 'Invalid custom_id format'
      }
    }

    // Extract translated content
    const content = output.response.body.choices[0]?.message?.content
    if (!content) {
      log.error('No content in response', { customId: output.custom_id })
      return {
        customId: output.custom_id,
        targetLocale: parsed.targetLocale,
        fileName: parsed.fileName,
        filePath: '',
        status: 'error',
        errorMessage: 'No content in response'
      }
    }

    // Parse translated delta JSON
    let translatedDelta: Record<string, any>
    try {
      translatedDelta = JSON.parse(content)
    } catch (error) {
      log.error('Failed to parse translated delta JSON', { customId: output.custom_id, error })
      return {
        customId: output.custom_id,
        targetLocale: parsed.targetLocale,
        fileName: parsed.fileName,
        filePath: '',
        status: 'error',
        errorMessage: 'Invalid JSON in translated content'
      }
    }

    // Load original file
    const original = loadOriginalFile(sessionId, parsed.fileName)
    if (!original) {
      return {
        customId: output.custom_id,
        targetLocale: parsed.targetLocale,
        fileName: parsed.fileName,
        filePath: '',
        status: 'error',
        errorMessage: 'Original file not found'
      }
    }

    // Merge translated delta into original
    const merged = mergeTranslatedDelta(original, translatedDelta)

    // Save merged file
    saveTranslationFile(sessionId, parsed.targetLocale, parsed.fileName, merged)

    const translatedKeysCount = Object.keys(translatedDelta).length

    return {
      customId: output.custom_id,
      targetLocale: parsed.targetLocale,
      fileName: parsed.fileName,
      filePath: join(TMP_DIR, sessionId, 'translations', parsed.targetLocale, 'global', parsed.fileName.replace('.delta.json', '.json')),
      status: 'success',
      translatedKeysCount
    }
  } catch (error) {
    log.error('Error processing batch output line', { line, error })
    return null
  }
}

/**
 * Process OpenAI batch output for delta translations
 */
export async function processDeltaBatchOutput(
  sessionId: string,
  batchId: string
): Promise<ProcessDeltaBatchResult> {
  log.info('Processing delta batch output', { sessionId, batchId })

  // Load batch manifest
  const manifest = loadManifest(sessionId, batchId)
  
  // Find output file
  const openaiBatchId = manifest.openai?.batchId
  if (!openaiBatchId) {
    throw new Error(`Batch ${batchId} has no OpenAI batch ID`)
  }

  const outputFileName = `${openaiBatchId}_output.jsonl`
  if (!batchFileExists(sessionId, batchId, outputFileName)) {
    throw new Error(`Output file ${outputFileName} not found for batch ${batchId}`)
  }

  const outputFilePath = getBatchFilePath(sessionId, batchId, outputFileName)
  const outputContent = readFileSync(outputFilePath, 'utf-8')
  const lines = outputContent.trim().split('\n')

  log.info('Processing batch output lines', { sessionId, batchId, lineCount: lines.length })

  const processedDeltas: ProcessedDelta[] = []
  const translationsByLocale: Record<string, number> = {}

  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    const result = processBatchOutputLine(line, sessionId)
    if (result) {
      processedDeltas.push(result)

      if (result.status === 'success') {
        translationsByLocale[result.targetLocale] = (translationsByLocale[result.targetLocale] || 0) + 1
      }
    }
  }

  const successCount = processedDeltas.filter(d => d.status === 'success').length
  const errorCount = processedDeltas.filter(d => d.status === 'error').length

  log.info('Delta batch output processed', {
    sessionId,
    batchId,
    total: processedDeltas.length,
    success: successCount,
    errors: errorCount,
    translationsByLocale
  })

  return {
    sessionId,
    batchId,
    processedCount: successCount,
    errorCount,
    deltas: processedDeltas,
    translationsByLocale
  }
}
