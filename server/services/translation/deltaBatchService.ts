/**
 * Service for creating translation batches from delta files (changes workflow)
 */

import { readFileSync } from 'fs'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import type { JsonDelta, MarkdownDelta } from '../../types'
import { createScopedLogger } from '../../utils/logger'
import { writeBatchFile, sanitizeBatchSegment } from '../../utils/batchStorage'
import { getTranslationConfig } from '../../config/env'
import type { BatchManifest } from '../batch'
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
  contentFiles?: string[] // Full content files (markdown) to translate
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
  const { sessionId, sourceLocale, targetLocales, deltaFiles, contentFiles = [] } = options
  
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
    deltaFileCount: deltaFiles.length,
    contentFileCount: contentFiles.length
  })

  const requests: BatchRequest[] = []

  // Process each delta file (JSON or markdown translations)
  for (const deltaFilePath of deltaFiles) {
    const fileName = basename(deltaFilePath)
    const delta = readDeltaFile(deltaFilePath)

    if (!delta) {
      log.warn('Failed to read delta file', { deltaFilePath })
      continue
    }

    // Handle JSON deltas
    if (isJsonDelta(delta)) {
      // Combine added and modified keys for translation
      const keysToTranslate = {
        ...delta.added,
        ...delta.modified
      }

      if (Object.keys(keysToTranslate).length === 0) {
        log.info('No keys to translate in JSON delta', { fileName })
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
    // Handle markdown deltas
    else if (isMarkdownDelta(delta)) {
      if (delta.changes.length === 0) {
        log.info('No changes to translate in markdown delta', { fileName })
        continue
      }

      // Extract only lines that changed (added or modified)
      const linesToTranslate = delta.changes
        .filter(change => change.type === 'added' || change.type === 'modified')
        .map(change => change.newLine)

      if (linesToTranslate.length === 0) {
        log.info('No added/modified lines in markdown delta', { fileName })
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
                content: buildMarkdownDeltaSystemPrompt(sourceLocale, targetLocale)
              },
              {
                role: 'user',
                content: buildMarkdownDeltaUserPrompt(linesToTranslate, delta.changes)
              }
            ],
            response_format: { type: 'json_object' }
          }
        }

        requests.push(request)
      }
    }
  }

  // Process each content file (markdown)
  for (const contentFilePath of contentFiles) {
    const fileName = basename(contentFilePath)
    const content = readContentFile(contentFilePath)

    if (!content) {
      log.warn('Failed to read content file', { contentFilePath })
      continue
    }

    if (content.trim().length === 0) {
      log.info('Empty content file, skipping', { fileName })
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
              content: buildMarkdownSystemPrompt(sourceLocale, targetLocale)
            },
            {
              role: 'user',
              content: buildMarkdownUserPrompt(content)
            }
          ],
          temperature: 1,
          max_completion_tokens: 32768
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
  const types: Array<'global' | 'page' | 'content'> = []
  if (deltaFiles.length > 0) {
    types.push('global', 'page') // Delta files can be from global or page
  }
  if (contentFiles.length > 0) {
    types.push('content')
  }
  
  const manifestFiles = [
    ...deltaFiles.map(f => ({
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
    ...contentFiles.map(f => ({
      customId: buildCustomId(sessionId, sourceLocale, basename(f)),
      type: 'content' as const,
      format: 'markdown' as const,
      relativePath: basename(f),
      sourceLocale,
      targetLocale: targetLocales[0], // Just for the record
      folderPath: '',
      fileName: basename(f),
      size: 0
    }))
  ]
  
  const manifest: BatchManifest = {
    batchId,
    senderId: sessionId,
    types,
    sourceLocale,
    targetLocales,
    model,
    totalRequests: requests.length,
    files: manifestFiles,
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
 * Read and parse a delta JSON file (could be JsonDelta or MarkdownDelta)
 */
function readDeltaFile(filePath: string): JsonDelta | MarkdownDelta | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const delta = JSON.parse(content)
    return delta
  } catch (error) {
    log.error('Failed to parse delta file', { filePath, error })
    return null
  }
}

/**
 * Check if a delta is a MarkdownDelta
 */
function isMarkdownDelta(delta: any): delta is MarkdownDelta {
  return delta && Array.isArray(delta.changes) && delta.changes.length > 0
}

/**
 * Check if a delta is a JsonDelta
 */
function isJsonDelta(delta: any): delta is JsonDelta {
  return delta && ('added' in delta || 'modified' in delta || 'deleted' in delta)
}

/**
 * Read a content (markdown) file
 */
function readContentFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    log.error('Failed to read content file', { filePath, error })
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

/**
 * Build system prompt for markdown translation
 */
function buildMarkdownSystemPrompt(sourceLocale: string, targetLocale: string): string {
  return `You are a professional translator specializing in technical documentation and content.

Your task is to translate the provided Markdown content from ${sourceLocale} to ${targetLocale}.

CRITICAL RULES:
1. Preserve ALL Markdown syntax exactly (headers, links, code blocks, lists, etc.)
2. Preserve ALL frontmatter (YAML between ---) - translate only the values, not the keys
3. Do NOT translate:
   - Code blocks (content between \`\`\`)
   - Inline code (content between \`)
   - URLs and file paths
   - HTML tags and attributes
   - Variable names and placeholders
4. Maintain the same structure and formatting
5. Keep the same tone and style as the original
6. Return ONLY the translated markdown, with no explanations or comments
7. Ensure the translation is natural and idiomatic in ${targetLocale}`
}

/**
 * Build user prompt for markdown translation
 */
function buildMarkdownUserPrompt(content: string): string {
  return `Translate the following Markdown document:\n\n${content}`
}

/**
 * Build system prompt for markdown delta translation (line-by-line changes)
 */
function buildMarkdownDeltaSystemPrompt(sourceLocale: string, targetLocale: string): string {
  return `You are a professional translator specializing in technical documentation and content.

Your task is to translate individual lines of Markdown content from ${sourceLocale} to ${targetLocale}.

CRITICAL RULES:
1. Preserve ALL Markdown syntax exactly (headers, links, code blocks, lists, etc.)
2. Do NOT translate:
   - Code blocks or inline code
   - URLs and file paths
   - HTML tags and attributes
   - Variable names and placeholders
3. Maintain the same structure and formatting for each line
4. Keep the same tone and style as the original
5. Return a JSON object where keys are line numbers and values are the translated lines
6. Ensure translations are natural and idiomatic in ${targetLocale}

Example response format:
{
  "1": "Translated line 1",
  "3": "Translated line 3",
  "5": "Translated line 5"
}`
}

/**
 * Build user prompt for markdown delta translation
 */
function buildMarkdownDeltaUserPrompt(
  linesToTranslate: string[], 
  changes: MarkdownDelta['changes']
): string {
  // Build a mapping of line number to content for lines that need translation
  const lineMap = changes
    .filter(change => change.type === 'added' || change.type === 'modified')
    .reduce((acc, change, index) => {
      acc[change.lineNumber] = linesToTranslate[index]
      return acc
    }, {} as Record<number, string>)

  return `Translate the following lines from a Markdown document. Return a JSON object with line numbers as keys and translated content as values:\n\n${JSON.stringify(lineMap, null, 2)}`
}
