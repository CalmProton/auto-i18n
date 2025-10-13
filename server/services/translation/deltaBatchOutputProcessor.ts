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
 * Format: {sessionId}__{targetLocale}__{originalFileName}__{hash}
 * Example: calmproton-pxguru-804c881__ru__en_delta_json__914642da
 */
function parseCustomId(customId: string): { sessionId: string; targetLocale: string; sourceFileName: string } | null {
  const parts = customId.split('__')
  
  if (parts.length < 3) {
    log.error('Invalid custom_id format', { customId, parts })
    return null
  }

  const sessionId = parts[0]
  const targetLocale = parts[1]
  // The source file name is in format like "en_delta_json" -> should be "en.json"
  const sourceFileNamePart = parts[2]
  
  // Convert "en_delta_json" to "en.json"
  const sourceFileName = sourceFileNamePart.replace('_delta_json', '.json')

  return { sessionId, targetLocale, sourceFileName }
}

/**
 * Load the source delta file to get the structure
 */
function loadSourceDelta(sessionId: string, sourceFileName: string): JsonDelta | null {
  const deltaPath = join(TMP_DIR, sessionId, 'deltas', 'en', 'global', sourceFileName.replace('.json', '.delta.json'))

  if (!existsSync(deltaPath)) {
    log.warn('Source delta file not found', { sessionId, sourceFileName, deltaPath })
    return null
  }

  try {
    const content = readFileSync(deltaPath, 'utf-8')
    return JSON.parse(content) as JsonDelta
  } catch (error) {
    log.error('Failed to load source delta file', { sessionId, sourceFileName, error })
    return null
  }
}

/**
 * Save translation delta file (for incremental changes, we only save what changed)
 */
function saveTranslationDelta(
  sessionId: string,
  targetLocale: string,
  sourceFileName: string,
  translatedDelta: Record<string, any>
): void {
  // Transform source file name to target locale
  // Example: en.json -> ru.json
  const targetFileName = sourceFileName.replace(/^[a-z]{2}([-_][A-Z]{2})?\.json$/, `${targetLocale}.json`)
  
  // Save as a delta file that can be applied to the repo
  const outputPath = join(TMP_DIR, sessionId, 'translations', targetLocale, 'global', targetFileName)
  
  // Create directory if needed
  const outputDir = dirname(outputPath)
  mkdirSync(outputDir, { recursive: true })

  // Write only the translated changes (not merged with original)
  // This will be used to update specific keys in the GitHub repo
  writeFileSync(outputPath, JSON.stringify(translatedDelta, null, 2), 'utf-8')
  
  log.debug('Saved translation delta', { sessionId, targetLocale, sourceFileName, targetFileName, outputPath, keyCount: Object.keys(translatedDelta).length })
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
        fileName: parsed.sourceFileName,
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
        fileName: parsed.sourceFileName,
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
        fileName: parsed.sourceFileName,
        filePath: '',
        status: 'error',
        errorMessage: 'Invalid JSON in translated content'
      }
    }

    // Save translation delta (we don't need to merge - GitHub has the originals)
    saveTranslationDelta(sessionId, parsed.targetLocale, parsed.sourceFileName, translatedDelta)

    // Transform source file name to target file name
    const targetFileName = parsed.sourceFileName.replace(/^[a-z]{2}([-_][A-Z]{2})?\.json$/, `${parsed.targetLocale}.json`)
    
    const translatedKeysCount = Object.keys(translatedDelta).length
    const outputPath = join(TMP_DIR, sessionId, 'translations', parsed.targetLocale, 'global', targetFileName)

    log.debug('Processed translation delta', {
      customId: output.custom_id,
      targetLocale: parsed.targetLocale,
      sourceFileName: parsed.sourceFileName,
      targetFileName,
      keysTranslated: translatedKeysCount
    })

    return {
      customId: output.custom_id,
      targetLocale: parsed.targetLocale,
      fileName: targetFileName,
      filePath: outputPath,
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
