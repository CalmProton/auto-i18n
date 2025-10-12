/**
 * Service for creating translation batches from delta files (changes workflow)
 */

import { readFileSync } from 'fs'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import type { JsonDelta } from '../../types'
import { createScopedLogger } from '../../utils/logger'
import { writeBatchFile, sanitizeBatchSegment } from '../../utils/batchStorage'
import { getTranslationConfig } from '../../config/env'
import type { BatchManifest } from './openaiBatchService'
import type OpenAI from 'openai'

const log = createScopedLogger('services:deltaBatchService')

// Internal batch request type matching OpenAI Batch API format
interface BatchRequest {
  custom_id: string
  method: 'POST'
  url: '/v1/chat/completions'
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
}

export interface CreateDeltaBatchOptions {
  sessionId: string
  sourceLocale: string
  targetLocales: string[]
  deltaFiles: string[]
}

export interface CreateDeltaBatchResult {
  batchId: string
  requestCount: number
  inputFile: string
}

/**
 * Create a batch from delta files for incremental translation
 */
export async function createDeltaBatch(options: CreateDeltaBatchOptions): Promise<CreateDeltaBatchResult> {
  const { sessionId, sourceLocale, targetLocales, deltaFiles } = options
  
  // Get OpenAI config
  const config = getTranslationConfig()
  if (config.provider !== 'openai') {
    throw new Error('OpenAI provider must be configured to use batch processing')
  }
  const model = config.providerConfig?.model || 'gpt-4o-mini'

  log.info('Creating delta batch', {
    sessionId,
    sourceLocale,
    targetLocales: targetLocales.length,
    deltaFileCount: deltaFiles.length
  })

  const requests: BatchRequest[] = []

  // Process each delta file
  for (const deltaFilePath of deltaFiles) {
    const fileName = basename(deltaFilePath)
    const delta = readDeltaFile(deltaFilePath)

    if (!delta) {
      log.warn('Failed to read delta file', { deltaFilePath })
      continue
    }

    // Combine added and modified keys for translation
    const keysToTranslate = {
      ...delta.added,
      ...delta.modified
    }

    if (Object.keys(keysToTranslate).length === 0) {
      log.info('No keys to translate in delta', { fileName })
      continue
    }

    // Create translation requests for each target locale
    for (const targetLocale of targetLocales) {
      const customId = buildCustomId(sessionId, targetLocale, fileName)
      
      const request: BatchRequest = {
        custom_id: customId,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model,
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(sourceLocale, targetLocale)
            },
            {
              role: 'user',
              content: buildUserPrompt(keysToTranslate)
            }
          ],
          response_format: { type: 'json_object' }
        }
      }

      requests.push(request)
    }
  }

  if (requests.length === 0) {
    throw new Error('No translation requests could be generated from delta files')
  }

  // Create batch ID and write input file
  const batchId = `batch_delta_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`
  const INPUT_FILE_NAME = 'input.jsonl'
  
  // Serialize requests to JSONL format
  const jsonlContent = requests.map(req => JSON.stringify(req)).join('\n')
  const inputFile = writeBatchFile(sessionId, batchId, INPUT_FILE_NAME, jsonlContent)

  // Create manifest
  const manifest: BatchManifest = {
    batchId,
    senderId: sessionId,
    types: ['global'], // Deltas are JSON files
    sourceLocale,
    targetLocales,
    model,
    totalRequests: requests.length,
    files: deltaFiles.map(f => ({
      customId: buildCustomId(sessionId, sourceLocale, basename(f)),
      type: 'global' as const,
      format: 'json' as const,
      relativePath: basename(f),
      sourceLocale,
      targetLocale: targetLocales[0], // Just for the record
      folderPath: '',
      fileName: basename(f),
      size: 0
    })),
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  // Write manifest
  writeBatchFile(sessionId, batchId, 'manifest.json', JSON.stringify(manifest, null, 2))

  log.info('Delta batch created', {
    sessionId,
    batchId,
    requestCount: requests.length
  })

  return {
    batchId,
    requestCount: requests.length,
    inputFile
  }
}

/**
 * Read and parse a delta JSON file
 */
function readDeltaFile(filePath: string): JsonDelta | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const delta = JSON.parse(content) as JsonDelta
    return delta
  } catch (error) {
    log.error('Failed to parse delta file', { filePath, error })
    return null
  }
}

/**
 * Build custom ID for request tracking
 */
function buildCustomId(sessionId: string, targetLocale: string, fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${sessionId}__${targetLocale}__${sanitized}__${randomUUID().slice(0, 8)}`
}

/**
 * Build system prompt for translation
 */
function buildSystemPrompt(sourceLocale: string, targetLocale: string): string {
  return `You are a professional translator. Translate the provided JSON key-value pairs from ${sourceLocale} to ${targetLocale}.

IMPORTANT RULES:
1. Maintain the exact same JSON structure and keys
2. Only translate the VALUES, never translate the keys
3. Preserve any placeholders like {variable}, {{variable}}, %s, %d, etc.
4. Maintain HTML tags and markdown formatting if present
5. Keep the same tone and style as the original
6. Return ONLY valid JSON with the same keys and translated values
7. Do not add any explanations or comments

Example:
Input: {"welcome": "Hello", "goodbye": "Goodbye"}
Output: {"welcome": "Bonjour", "goodbye": "Au revoir"}`
}

/**
 * Build user prompt with the content to translate
 */
function buildUserPrompt(content: Record<string, any>): string {
  return `Translate the following JSON object:\n\n${JSON.stringify(content, null, 2)}`
}
