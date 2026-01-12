/**
 * OpenAI Batch Service
 * Handles batch translation requests using OpenAI's Batch API
 */
import { createReadStream } from 'node:fs'
import OpenAI from 'openai'
import { getTranslationConfig } from '../../../../config/env'
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildJsonTranslationPrompt,
  buildMarkdownTranslationPrompt,
  JSON_RESPONSE_DIRECTIVE,
  JSON_TRANSLATION_WRAPPER_DIRECTIVE,
  MARKDOWN_RESPONSE_DIRECTIVE
} from '../../../translation/prompts'
import { resolveOpenAIModel } from '../../../translation/providers/openaiProvider'
import { resolveUploadPath } from '../../../../utils/fileStorage'
import {
  batchFileExists,
  getBatchFilePath,
  readBatchFile,
  writeBatchFile
} from '../../../../utils/batchStorage'
import { createScopedLogger } from '../../../../utils/logger'
import { stringifyJson } from '../../../translation/providerShared'
import {
  collectContentSources,
  collectJsonSources,
  getTargetLocales,
  shouldIncludeFile,
  buildCustomId,
  loadManifest,
  saveManifest,
  generateOpenAIBatchId
} from '../../common'
import type {
  BatchManifest,
  BatchRequestRecord,
  BatchSourceFile,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult,
  CreateRetryBatchOptions,
  CreateRetryBatchResult,
  BatchTranslationType,
  BatchRequestFormat
} from '../../types'

const log = createScopedLogger('batch:openai')

const REQUEST_ENDPOINT = '/v1/chat/completions'
const COMPLETION_WINDOW = '24h'
const INPUT_FILE_NAME = 'input.jsonl'
const FILE_UPLOAD_RESPONSE_NAME = 'upload-response.json'
const BATCH_RESPONSE_NAME = 'openai-batch-response.json'

// ============================================================================
// Provider Configuration
// ============================================================================

interface OpenAIProviderConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

function getOpenAIProviderInfo(): { model: string; providerConfig: OpenAIProviderConfig } {
  const config = getTranslationConfig()
  
  // Allow OpenAI batch even if not primary provider
  if (config.providers.openai) {
    const providerConfig = config.providers.openai
    const resolvedModel = resolveOpenAIModel(providerConfig)
    return { model: resolvedModel, providerConfig }
  }
  
  if (config.provider !== 'openai') {
    throw new Error('OpenAI provider must be configured to use batch processing')
  }
  
  const providerConfig = config.providerConfig as OpenAIProviderConfig | undefined
  if (!providerConfig) {
    throw new Error('OpenAI provider configuration is missing API key')
  }
  
  const resolvedModel = resolveOpenAIModel(providerConfig)
  return { model: resolvedModel, providerConfig }
}

function createOpenAIClient(providerConfig: OpenAIProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: providerConfig.apiKey,
    ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {})
  })
}

// ============================================================================
// Request Building
// ============================================================================

interface BatchRequest {
  format: BatchRequestFormat
  customId: string
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  record: BatchRequestRecord
}

function buildMarkdownRequestBody(options: {
  model: string
  instruction: string
  content: string
}): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const { model, instruction, content } = options
  return {
    model,
    messages: [
      { role: 'system' as const, content: TRANSLATION_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `${instruction}\n\n---\n${content}\n---\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
      }
    ],
    temperature: 1,
    max_completion_tokens: 32768
  }
}

function buildJsonRequestBody(options: {
  model: string
  instruction: string
  data: unknown
}): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const { model, instruction, data } = options
  return {
    model,
    messages: [
      { role: 'system' as const, content: TRANSLATION_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n${JSON_RESPONSE_DIRECTIVE}`
      }
    ],
    temperature: 1,
    max_completion_tokens: 32768,
    response_format: { type: 'json_object' }
  }
}

async function buildMarkdownRequests(options: {
  senderId: string
  sourceLocale: string
  targetLocales: string[]
  sources: BatchSourceFile[]
  model: string
}): Promise<BatchRequest[]> {
  const { senderId, sourceLocale, targetLocales, sources, model } = options
  const requests: BatchRequest[] = []

  for (const source of sources) {
    const content = await Bun.file(source.filePath).text()
    for (const targetLocale of targetLocales) {
      const instruction = buildMarkdownTranslationPrompt(sourceLocale, targetLocale)
      const customId = buildCustomId(senderId, targetLocale, source.type, source.relativePath, source.format)
      requests.push({
        format: 'markdown',
        customId,
        body: buildMarkdownRequestBody({ model, instruction, content }),
        record: {
          customId,
          type: source.type,
          format: 'markdown',
          relativePath: source.relativePath,
          sourceLocale,
          targetLocale,
          folderPath: source.folderPath,
          fileName: source.fileName,
          size: source.size
        }
      })
    }
  }

  return requests
}

async function buildJsonRequests(options: {
  senderId: string
  sourceLocale: string
  targetLocales: string[]
  sources: BatchSourceFile[]
  model: string
}): Promise<BatchRequest[]> {
  const { senderId, sourceLocale, targetLocales, sources, model } = options
  const requests: BatchRequest[] = []

  for (const source of sources) {
    let parsed: unknown
    try {
      const text = await Bun.file(source.filePath).text()
      parsed = JSON.parse(text)
    } catch (error) {
      log.error('Failed to parse JSON source for batch request', {
        senderId,
        sourceLocale,
        type: source.type,
        relativePath: source.relativePath,
        error
      })
      continue
    }

    for (const targetLocale of targetLocales) {
      const instruction = buildJsonTranslationPrompt(sourceLocale, targetLocale)
      const customId = buildCustomId(senderId, targetLocale, source.type, source.relativePath, source.format)
      requests.push({
        format: 'json',
        customId,
        body: buildJsonRequestBody({ model, instruction, data: parsed }),
        record: {
          customId,
          type: source.type,
          format: 'json',
          relativePath: source.relativePath,
          sourceLocale,
          targetLocale,
          folderPath: source.folderPath,
          fileName: source.fileName,
          size: source.size
        }
      })
    }
  }

  return requests
}

function serializeJsonl(requests: BatchRequest[]): string {
  return requests
    .map(({ customId, body }) =>
      JSON.stringify({
        custom_id: customId,
        method: 'POST',
        url: REQUEST_ENDPOINT,
        body
      })
    )
    .join('\n')
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a batch for OpenAI's Batch API
 */
export async function createBatch(options: CreateBatchOptions): Promise<CreateBatchResult> {
  const { senderId, sourceLocale, targetLocales: requestedTargets, includeFiles, types } = options
  const { model } = getOpenAIProviderInfo()

  const requestedTypes = types && types !== 'all' 
    ? new Set<BatchTranslationType>(types) 
    : null

  const sources: BatchSourceFile[] = []

  if (!requestedTypes || requestedTypes.has('content')) {
    const contentRoot = resolveUploadPath({ senderId, locale: sourceLocale, type: 'content', category: 'uploads' })
    const contentSources = await collectContentSources(contentRoot)
    sources.push(...contentSources)
  }

  if (!requestedTypes || requestedTypes.has('global')) {
    const globalRoot = resolveUploadPath({ senderId, locale: sourceLocale, type: 'global', category: 'uploads' })
    const globalSources = await collectJsonSources('global', globalRoot)
    sources.push(...globalSources)
  }

  if (!requestedTypes || requestedTypes.has('page')) {
    const pageRoot = resolveUploadPath({ senderId, locale: sourceLocale, type: 'page', category: 'uploads' })
    const pageSources = await collectJsonSources('page', pageRoot)
    sources.push(...pageSources)
  }

  const filteredSources = sources.filter((source) => 
    shouldIncludeFile(source.type, source.relativePath, includeFiles)
  )

  if (filteredSources.length === 0) {
    throw new Error('No matching files were found to include in the batch')
  }

  const targetLocales = getTargetLocales(sourceLocale, requestedTargets)

  const markdownSources = filteredSources.filter((s) => s.format === 'markdown')
  const jsonSources = filteredSources.filter((s) => s.format === 'json')

  const markdownRequests = markdownSources.length > 0
    ? await buildMarkdownRequests({ senderId, sourceLocale, targetLocales, sources: markdownSources, model })
    : []

  const jsonRequests = jsonSources.length > 0
    ? await buildJsonRequests({ senderId, sourceLocale, targetLocales, sources: jsonSources, model })
    : []

  const requests = [...markdownRequests, ...jsonRequests]

  if (requests.length === 0) {
    throw new Error('Unable to generate any translation requests for the batch')
  }

  const batchId = generateOpenAIBatchId(sourceLocale)
  const inputFilePath = writeBatchFile(senderId, batchId, INPUT_FILE_NAME, serializeJsonl(requests))

  const manifestTypes = Array.from(new Set(requests.map((r) => r.record.type))).sort()

  const manifest: BatchManifest = {
    batchId,
    senderId,
    provider: 'openai',
    types: manifestTypes,
    sourceLocale,
    targetLocales,
    model,
    totalRequests: requests.length,
    files: requests.map((r) => r.record),
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  saveManifest(senderId, batchId, manifest)

  log.info('Created OpenAI batch input', {
    senderId,
    sourceLocale,
    batchId,
    types: manifestTypes,
    targetLocales,
    fileCount: filteredSources.length,
    requestCount: requests.length
  })

  return {
    batchId,
    requestCount: requests.length,
    manifest,
    inputFilePath,
    provider: 'openai'
  }
}

/**
 * Submit a batch to OpenAI's Batch API
 */
export async function submitBatch(options: SubmitBatchOptions): Promise<SubmitBatchResult> {
  const { senderId, batchId, metadata } = options
  const { providerConfig } = getOpenAIProviderInfo()
  const client = createOpenAIClient(providerConfig)

  if (!batchFileExists(senderId, batchId, INPUT_FILE_NAME)) {
    throw new Error(`Batch ${batchId} has no input file to submit`)
  }

  const manifest = loadManifest(senderId, batchId)
  if (manifest.status !== 'draft') {
    log.warn('Submitting batch that is not in draft status', {
      senderId,
      batchId,
      currentStatus: manifest.status
    })
  }

  const inputFilePath = getBatchFilePath(senderId, batchId, INPUT_FILE_NAME)
  const fileResponse = await client.files.create({
    file: createReadStream(inputFilePath),
    purpose: 'batch'
  })

  writeBatchFile(senderId, batchId, FILE_UPLOAD_RESPONSE_NAME, JSON.stringify(fileResponse, null, 2))

  const batchResponse = await client.batches.create({
    input_file_id: fileResponse.id,
    endpoint: REQUEST_ENDPOINT,
    completion_window: COMPLETION_WINDOW,
    metadata: {
      senderId,
      batchId,
      types: manifest.types.join(','),
      sourceLocale: manifest.sourceLocale,
      ...(metadata ?? {})
    }
  })

  writeBatchFile(senderId, batchId, BATCH_RESPONSE_NAME, JSON.stringify(batchResponse, null, 2))

  const updatedManifest: BatchManifest = {
    ...manifest,
    status: 'submitted',
    openai: {
      inputFileId: fileResponse.id,
      batchId: batchResponse.id,
      endpoint: batchResponse.endpoint ?? REQUEST_ENDPOINT,
      status: batchResponse.status,
      submissionTimestamp: new Date().toISOString()
    }
  }

  saveManifest(senderId, batchId, updatedManifest)

  log.info('Submitted OpenAI batch for processing', {
    senderId,
    batchId,
    openaiBatchId: batchResponse.id,
    openaiStatus: batchResponse.status,
    requestCount: manifest.totalRequests
  })

  return {
    batchId,
    providerBatchId: batchResponse.id,
    providerStatus: batchResponse.status,
    provider: 'openai'
  }
}

/**
 * Check the status of a submitted batch with OpenAI
 */
export async function checkBatchStatus(options: CheckBatchStatusOptions): Promise<CheckBatchStatusResult> {
  const { senderId, batchId } = options
  const { providerConfig } = getOpenAIProviderInfo()
  const client = createOpenAIClient(providerConfig)

  const manifest = loadManifest(senderId, batchId)

  if (!manifest.openai?.batchId) {
    throw new Error(`Batch ${batchId} has not been submitted to OpenAI`)
  }

  const openaiBatchId = manifest.openai.batchId

  try {
    const batchStatus = await client.batches.retrieve(openaiBatchId)

    const updatedManifest: BatchManifest = {
      ...manifest,
      openai: {
        ...manifest.openai,
        status: batchStatus.status
      },
      updatedAt: new Date().toISOString()
    }

    // Download files if batch is in terminal state
    if (batchStatus.status === 'completed' || batchStatus.status === 'failed') {
      if (batchStatus.output_file_id) {
        try {
          const outputContent = await client.files.content(batchStatus.output_file_id)
          const outputText = await outputContent.text()
          writeBatchFile(senderId, batchId, `${openaiBatchId}_output.jsonl`, outputText)
          log.info('Downloaded batch output file', { senderId, batchId, openaiBatchId })
        } catch (error) {
          log.error('Failed to download output file', { senderId, batchId, openaiBatchId, error })
        }
      }

      if (batchStatus.error_file_id) {
        try {
          const errorContent = await client.files.content(batchStatus.error_file_id)
          const errorText = await errorContent.text()
          writeBatchFile(senderId, batchId, `${openaiBatchId}_error.jsonl`, errorText)
          log.info('Downloaded batch error file', { senderId, batchId, openaiBatchId })
        } catch (error) {
          log.error('Failed to download error file', { senderId, batchId, openaiBatchId, error })
        }
      }

      updatedManifest.status = batchStatus.status === 'completed' ? 'completed' : 'failed'
    }

    saveManifest(senderId, batchId, updatedManifest)

    log.info('Checked OpenAI batch status', {
      senderId,
      batchId,
      openaiBatchId,
      status: batchStatus.status,
      requestCounts: batchStatus.request_counts
    })

    return {
      batchId,
      providerBatchId: openaiBatchId,
      status: batchStatus.status,
      provider: 'openai',
      requestCounts: batchStatus.request_counts
        ? {
            total: batchStatus.request_counts.total,
            completed: batchStatus.request_counts.completed,
            failed: batchStatus.request_counts.failed
          }
        : undefined,
      outputFileId: batchStatus.output_file_id ?? undefined,
      errorFileId: batchStatus.error_file_id ?? undefined
    }
  } catch (error) {
    log.error('Failed to check OpenAI batch status', { senderId, batchId, openaiBatchId, error })
    throw error
  }
}

/**
 * Creates a new batch from failed requests in an error JSONL file
 */
export async function createRetryBatch(options: CreateRetryBatchOptions): Promise<CreateRetryBatchResult> {
  const { senderId, originalBatchId, errorFileName, model: overrideModel } = options

  const originalManifest = loadManifest(senderId, originalBatchId)
  const { model: defaultModel } = getOpenAIProviderInfo()
  const model = overrideModel ?? defaultModel

  if (!batchFileExists(senderId, originalBatchId, errorFileName)) {
    throw new Error(`Error file ${errorFileName} not found for batch ${originalBatchId}`)
  }
  
  const errorContent = readBatchFile(senderId, originalBatchId, errorFileName)
  const errorLines = errorContent.trim().split('\n').filter((line) => line.trim().length > 0)
  const failedCustomIds = new Set<string>()

  for (const line of errorLines) {
    try {
      const errorRecord = JSON.parse(line)
      if (errorRecord.custom_id) {
        failedCustomIds.add(errorRecord.custom_id)
      }
    } catch (error) {
      log.warn('Failed to parse error record line', { line, error })
    }
  }

  if (failedCustomIds.size === 0) {
    throw new Error('No failed requests found in error file')
  }

  if (!batchFileExists(senderId, originalBatchId, INPUT_FILE_NAME)) {
    throw new Error(`Original input file not found for batch ${originalBatchId}`)
  }
  
  const originalInputContent = readBatchFile(senderId, originalBatchId, INPUT_FILE_NAME)
  const originalInputLines = originalInputContent.trim().split('\n').filter((line) => line.trim().length > 0)

  interface OriginalBatchRequest {
    custom_id: string
    method: string
    url: string
    body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  }

  const failedRequests: OriginalBatchRequest[] = []

  for (const line of originalInputLines) {
    try {
      const request = JSON.parse(line) as OriginalBatchRequest
      if (failedCustomIds.has(request.custom_id)) {
        failedRequests.push(request)
      }
    } catch (error) {
      log.warn('Failed to parse original input line', { line, error })
    }
  }

  if (failedRequests.length === 0) {
    throw new Error('Could not find any matching failed requests in the original input file')
  }

  const updatedRequests = failedRequests.map((request) => ({
    ...request,
    body: { ...request.body, model }
  }))

  const newBatchId = generateOpenAIBatchId(originalManifest.sourceLocale)
  const newInputContent = updatedRequests.map((request) => JSON.stringify(request)).join('\n')
  const inputFilePath = writeBatchFile(senderId, newBatchId, INPUT_FILE_NAME, newInputContent)

  const failedFileRecords = originalManifest.files.filter((file) => failedCustomIds.has(file.customId))

  const newManifest: BatchManifest = {
    batchId: newBatchId,
    senderId,
    provider: 'openai',
    types: originalManifest.types,
    sourceLocale: originalManifest.sourceLocale,
    targetLocales: originalManifest.targetLocales,
    model,
    totalRequests: updatedRequests.length,
    files: failedFileRecords,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  saveManifest(senderId, newBatchId, newManifest)

  log.info('Created retry batch from failed requests', {
    senderId,
    originalBatchId,
    newBatchId,
    failedCount: failedCustomIds.size,
    retryRequestCount: updatedRequests.length
  })

  return {
    batchId: newBatchId,
    requestCount: updatedRequests.length,
    failedRequestCount: failedCustomIds.size,
    manifest: newManifest,
    inputFilePath
  }
}
