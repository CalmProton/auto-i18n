/**
 * Mock Batch Service
 *
 * Provides mock implementations for batch operations when in mock mode.
 * Generates placeholder translations without calling OpenAI's Batch API.
 */
import { randomUUID } from 'node:crypto'
import { getBatchFilePath, readBatchFile, writeBatchFile, batchFileExists } from '../../utils/batchStorage'
import { createScopedLogger } from '../../utils/logger'
import type { BatchManifest, BatchRequestRecord, CreateBatchResult, SubmitBatchResult, CheckBatchStatusResult } from './openaiBatchService'

const log = createScopedLogger('translation:mockBatch')

const MOCK_BATCH_ID_PREFIX = 'mock_batch_'
const MOCK_OUTPUT_FILE_NAME = 'mock_output.jsonl'

interface MockBatchOptions {
  senderId: string
  batchId: string
  simulatedDelayMs?: number
}

/**
 * Generate a mock OpenAI batch ID
 */
export function generateMockBatchId(): string {
  return `${MOCK_BATCH_ID_PREFIX}${randomUUID().slice(0, 8)}`
}

/**
 * Check if a batch ID is a mock batch
 */
export function isMockBatch(batchId: string): boolean {
  return batchId.startsWith(MOCK_BATCH_ID_PREFIX)
}

/**
 * Submit a batch in mock mode - immediately generates mock output
 */
export async function submitMockBatch(options: MockBatchOptions): Promise<SubmitBatchResult> {
  const { senderId, batchId, simulatedDelayMs = 500 } = options

  // Simulate processing delay
  await delay(simulatedDelayMs)

  const manifestPath = getBatchFilePath(senderId, batchId, 'manifest.json')
  if (!batchFileExists(senderId, batchId, 'manifest.json')) {
    throw new Error(`Batch ${batchId} manifest not found`)
  }

  const manifestContent = readBatchFile(senderId, batchId, 'manifest.json')
  const manifest: BatchManifest = JSON.parse(manifestContent)

  const mockOpenAiBatchId = generateMockBatchId()

  // Generate mock output immediately
  await generateMockOutput(senderId, batchId, manifest)

  // Update manifest with mock batch info
  const updatedManifest: BatchManifest = {
    ...manifest,
    status: 'completed',
    updatedAt: new Date().toISOString(),
    openai: {
      inputFileId: `mock_file_${randomUUID().slice(0, 8)}`,
      batchId: mockOpenAiBatchId,
      endpoint: '/v1/chat/completions',
      status: 'completed',
      submissionTimestamp: new Date().toISOString(),
    },
  }

  writeBatchFile(senderId, batchId, 'manifest.json', JSON.stringify(updatedManifest, null, 2))

  log.info('Mock batch submitted and completed', {
    senderId,
    batchId,
    mockOpenAiBatchId,
    requestCount: manifest.totalRequests,
  })

  return {
    batchId,
    openaiBatchId: mockOpenAiBatchId,
    openaiStatus: 'completed',
    inputFileId: `mock_file_${randomUUID().slice(0, 8)}`,
  }
}

/**
 * Check status of a mock batch - always returns completed
 */
export async function checkMockBatchStatus(options: MockBatchOptions): Promise<CheckBatchStatusResult> {
  const { senderId, batchId } = options

  const manifestContent = readBatchFile(senderId, batchId, 'manifest.json')
  const manifest: BatchManifest = JSON.parse(manifestContent)

  const mockOutputFileName = getMockOutputFileName(manifest.openai?.batchId)

  return {
    batchId,
    openaiBatchId: manifest.openai?.batchId ?? generateMockBatchId(),
    status: 'completed',
    requestCounts: {
      total: manifest.totalRequests,
      completed: manifest.totalRequests,
      failed: 0,
    },
    outputFileId: batchFileExists(senderId, batchId, mockOutputFileName)
      ? `mock_output_${batchId}`
      : undefined,
  }
}

/**
 * Generate mock output JSONL file with placeholder translations
 */
async function generateMockOutput(
  senderId: string,
  batchId: string,
  manifest: BatchManifest
): Promise<void> {
  if (!batchFileExists(senderId, batchId, 'input.jsonl')) {
    throw new Error(`Batch ${batchId} has no input file`)
  }

  const inputContent = readBatchFile(senderId, batchId, 'input.jsonl')
  const inputLines = inputContent.trim().split('\n').filter((line) => line.trim())

  const outputLines: string[] = []

  for (const line of inputLines) {
    const request = JSON.parse(line) as {
      custom_id: string
      method: string
      url: string
      body: {
        model: string
        messages: Array<{ role: string; content: string }>
      }
    }

    // Find the corresponding request record
    const record = manifest.files.find((f) => f.customId === request.custom_id)

    // Generate mock response based on request type
    const mockContent = generateMockContent(request, record)

    const outputRecord = {
      id: `mock_response_${randomUUID().slice(0, 8)}`,
      custom_id: request.custom_id,
      response: {
        status_code: 200,
        request_id: `mock_req_${randomUUID().slice(0, 8)}`,
        body: {
          id: `mock_chatcmpl_${randomUUID().slice(0, 8)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: mockContent,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      },
      error: null,
    }

    outputLines.push(JSON.stringify(outputRecord))
  }

  const mockOutputFileName = getMockOutputFileName(manifest.openai?.batchId ?? `mock_${batchId}`)
  writeBatchFile(senderId, batchId, mockOutputFileName, outputLines.join('\n'))

  log.info('Generated mock batch output', {
    senderId,
    batchId,
    outputFile: mockOutputFileName,
    requestCount: outputLines.length,
  })
}

/**
 * Generate mock translated content based on the request
 */
function generateMockContent(
  request: {
    custom_id: string
    body: {
      messages: Array<{ role: string; content: string }>
    }
  },
  record?: BatchRequestRecord
): string {
  const customId = request.custom_id
  const userMessage = request.body.messages.find((m) => m.role === 'user')?.content ?? ''

  // Parse custom_id format: type:path:sourceLocale:targetLocale
  const idParts = customId.split(':')
  const targetLocale = idParts[idParts.length - 1] || 'unknown'
  const sourceLocale = idParts[idParts.length - 2] || 'en'
  const filePath = record?.relativePath || idParts.slice(1, -2).join(':') || 'unknown'

  // Determine if this is JSON or Markdown based on format or content
  const isJson = record?.format === 'json' || userMessage.includes('"') && userMessage.includes('{')

  if (isJson) {
    // Try to extract and mock the JSON content
    return generateMockJsonTranslation(userMessage, sourceLocale, targetLocale, filePath)
  } else {
    // Mock markdown content
    return generateMockMarkdownTranslation(userMessage, sourceLocale, targetLocale, filePath)
  }
}

/**
 * Generate mock JSON translation with placeholder strings
 */
function generateMockJsonTranslation(
  content: string,
  sourceLocale: string,
  targetLocale: string,
  filePath: string
): string {
  // Try to extract JSON from the content
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) {
    return `{"error": "{translated ${sourceLocale}.error to ${targetLocale}}"}`
  }

  try {
    const jsonContent = JSON.parse(jsonMatch[1])
    const mockTranslated = mockJsonValue(jsonContent, sourceLocale, targetLocale, [])
    // Wrap in translation_result as expected by the output processor
    return JSON.stringify({ translation_result: mockTranslated })
  } catch {
    return `{"translation_result": {"error": "{translated ${sourceLocale}.parse_error to ${targetLocale}}"}}`
  }
}

/**
 * Recursively mock JSON values
 */
function mockJsonValue(
  value: unknown,
  sourceLocale: string,
  targetLocale: string,
  keyPath: string[]
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      mockJsonValue(item, sourceLocale, targetLocale, [...keyPath, String(index)])
    )
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = mockJsonValue(val, sourceLocale, targetLocale, [...keyPath, key])
    }
    return result
  }

  if (typeof value === 'string') {
    const keyPathStr = keyPath.join('.')
    return `{translated ${sourceLocale}.${keyPathStr} to ${targetLocale}}`
  }

  return value
}

/**
 * Generate mock Markdown translation
 */
function generateMockMarkdownTranslation(
  content: string,
  sourceLocale: string,
  targetLocale: string,
  filePath: string
): string {
  const fileName = filePath.split('/').pop()?.replace(/\.(md|mdx)$/i, '') || 'content'

  // Find the actual content to translate (after the prompt instructions)
  const contentMatch = content.match(/Content to translate:\s*([\s\S]*)/) || content.match(/```markdown\s*([\s\S]*?)```/)
  const actualContent = contentMatch?.[1]?.trim() || content

  const lines = actualContent.split('\n')
  const mockLines = lines.map((line, index) => {
    if (!line.trim()) {
      return line
    }

    // Preserve frontmatter delimiters
    if (line.trim() === '---') {
      return line
    }

    // Preserve code blocks
    if (line.trim().startsWith('```')) {
      return line
    }

    // Preserve imports
    if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) {
      return line
    }

    // Mock headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const [, hashes] = headingMatch
      return `${hashes} {translated ${sourceLocale}.${fileName}.heading_${index} to ${targetLocale}}`
    }

    // Mock frontmatter values
    const frontmatterMatch = line.match(/^(\s*)([\w-]+):\s*(.+)$/)
    if (frontmatterMatch) {
      const [, indent, key, value] = frontmatterMatch
      if (value.startsWith('"') || value.startsWith("'") || /^[a-zA-Z]/.test(value)) {
        return `${indent}${key}: "{translated ${sourceLocale}.${fileName}.${key} to ${targetLocale}}"`
      }
      return line
    }

    // Mock regular text
    if (line.trim().length > 0) {
      const indent = line.match(/^(\s*)/)?.[1] || ''
      return `${indent}{translated ${sourceLocale}.${fileName}.line_${index} to ${targetLocale}}`
    }

    return line
  })

  return mockLines.join('\n')
}

/**
 * Get the output file name for a mock batch
 */
function getMockOutputFileName(openaiBatchId?: string): string {
  return openaiBatchId ? `${openaiBatchId}_output.jsonl` : MOCK_OUTPUT_FILE_NAME
}

/**
 * Helper to simulate async delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
