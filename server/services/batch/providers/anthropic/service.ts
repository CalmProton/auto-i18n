/**
 * Anthropic Batch Service
 * Handles batch translation requests using Anthropic's Message Batches API
 */
import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import { getTranslationConfig } from '../../../../config/env'
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildJsonTranslationPrompt,
  buildMarkdownTranslationPrompt,
  JSON_RESPONSE_DIRECTIVE,
  JSON_TRANSLATION_WRAPPER_DIRECTIVE,
  MARKDOWN_RESPONSE_DIRECTIVE
} from '../../../translation/prompts'
import { resolveUploadPath } from '../../../../utils/fileStorage'
import {
  batchFileExists,
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
  generateAnthropicBatchId
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
  BatchTranslationType,
  BatchRequestFormat
} from '../../types'

const log = createScopedLogger('batch:anthropic')

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307'
const INPUT_FILE_NAME = 'input.json'
const BATCH_RESPONSE_NAME = 'anthropic-batch-response.json'

// ============================================================================
// Provider Configuration
// ============================================================================

interface AnthropicProviderConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

function getAnthropicProviderInfo(): { model: string; providerConfig: AnthropicProviderConfig } {
  const config = getTranslationConfig()

  // Allow Anthropic batch even if not primary provider
  if (config.providers.anthropic) {
    const providerConfig = config.providers.anthropic
    const model = providerConfig.model?.trim() || DEFAULT_ANTHROPIC_MODEL
    return { model, providerConfig }
  }

  if (config.provider !== 'anthropic') {
    throw new Error('Anthropic provider must be configured to use batch processing')
  }

  const providerConfig = config.providerConfig as AnthropicProviderConfig | undefined
  if (!providerConfig) {
    throw new Error('Anthropic provider configuration is missing API key')
  }

  const model = providerConfig.model?.trim() || DEFAULT_ANTHROPIC_MODEL
  return { model, providerConfig }
}

function createAnthropicClient(providerConfig: AnthropicProviderConfig): Anthropic {
  return new Anthropic({
    apiKey: providerConfig.apiKey,
    ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {})
  })
}

// ============================================================================
// Request Building
// ============================================================================

interface AnthropicBatchRequest {
  custom_id: string
  params: MessageCreateParamsNonStreaming
}

interface BatchRequest {
  format: BatchRequestFormat
  customId: string
  params: MessageCreateParamsNonStreaming
  record: BatchRequestRecord
}

function buildMarkdownRequestParams(options: {
  model: string
  instruction: string
  content: string
}): MessageCreateParamsNonStreaming {
  const { model, instruction, content } = options
  return {
    model,
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: `${instruction}\n\n---\n${content}\n---\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
      }
    ],
    max_tokens: 32768
  }
}

function buildJsonRequestParams(options: {
  model: string
  instruction: string
  data: unknown
}): MessageCreateParamsNonStreaming {
  const { model, instruction, data } = options
  return {
    model,
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n${JSON_RESPONSE_DIRECTIVE}`
      }
    ],
    max_tokens: 32768
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
        params: buildMarkdownRequestParams({ model, instruction, content }),
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
        params: buildJsonRequestParams({ model, instruction, data: parsed }),
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a batch for Anthropic Message Batches API
 */
export async function createBatch(options: CreateBatchOptions): Promise<CreateBatchResult> {
  const { senderId, sourceLocale, targetLocales: requestedTargets, includeFiles, types } = options
  const { model } = getAnthropicProviderInfo()

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

  if (requests.length > 100000) {
    throw new Error(`Batch size exceeds Anthropic limit of 100,000 requests (${requests.length} requests)`)
  }

  const batchId = generateAnthropicBatchId(sourceLocale)

  const anthropicRequests: AnthropicBatchRequest[] = requests.map(({ customId, params }) => ({
    custom_id: customId,
    params
  }))

  const inputFilePath = writeBatchFile(
    senderId,
    batchId,
    INPUT_FILE_NAME,
    JSON.stringify(anthropicRequests, null, 2)
  )

  const manifestTypes = Array.from(new Set(requests.map((r) => r.record.type))).sort()

  const manifest: BatchManifest = {
    batchId,
    senderId,
    provider: 'anthropic',
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

  log.info('Created Anthropic batch input', {
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
    provider: 'anthropic'
  }
}

/**
 * Submit a batch to Anthropic's Message Batches API
 */
export async function submitBatch(options: SubmitBatchOptions): Promise<SubmitBatchResult> {
  const { senderId, batchId } = options
  const { providerConfig } = getAnthropicProviderInfo()
  const client = createAnthropicClient(providerConfig)

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

  const inputContent = readBatchFile(senderId, batchId, INPUT_FILE_NAME)
  const requests: AnthropicBatchRequest[] = JSON.parse(inputContent)

  const batchResponse = await client.messages.batches.create({
    requests: requests.map((req) => ({
      custom_id: req.custom_id,
      params: req.params
    }))
  })

  writeBatchFile(senderId, batchId, BATCH_RESPONSE_NAME, JSON.stringify(batchResponse, null, 2))

  const updatedManifest: BatchManifest = {
    ...manifest,
    status: 'submitted',
    anthropic: {
      batchId: batchResponse.id,
      status: batchResponse.processing_status,
      submissionTimestamp: new Date().toISOString(),
      processingStatus: batchResponse.processing_status
    }
  }

  saveManifest(senderId, batchId, updatedManifest)

  log.info('Submitted Anthropic batch for processing', {
    senderId,
    batchId,
    anthropicBatchId: batchResponse.id,
    processingStatus: batchResponse.processing_status,
    requestCount: manifest.totalRequests
  })

  return {
    batchId,
    providerBatchId: batchResponse.id,
    providerStatus: batchResponse.processing_status,
    provider: 'anthropic'
  }
}

/**
 * Check the status of a submitted batch with Anthropic
 */
export async function checkBatchStatus(options: CheckBatchStatusOptions): Promise<CheckBatchStatusResult> {
  const { senderId, batchId } = options
  const { providerConfig } = getAnthropicProviderInfo()
  const client = createAnthropicClient(providerConfig)

  const manifest = loadManifest(senderId, batchId)

  if (!manifest.anthropic?.batchId) {
    throw new Error(`Batch ${batchId} has not been submitted to Anthropic`)
  }

  const anthropicBatchId = manifest.anthropic.batchId

  try {
    const batchStatus = await client.messages.batches.retrieve(anthropicBatchId)

    const updatedManifest: BatchManifest = {
      ...manifest,
      anthropic: {
        ...manifest.anthropic,
        status: batchStatus.processing_status,
        processingStatus: batchStatus.processing_status,
        resultsUrl: batchStatus.results_url ?? undefined
      },
      updatedAt: new Date().toISOString()
    }

    // Download results if batch is complete
    if (batchStatus.processing_status === 'ended') {
      updatedManifest.status = 'completed'

      if (batchStatus.results_url) {
        try {
          const results: unknown[] = []
          const resultsDecoder = await client.messages.batches.results(anthropicBatchId)
          for await (const result of resultsDecoder) {
            results.push(result)
          }
          writeBatchFile(
            senderId,
            batchId,
            `${anthropicBatchId}_output.json`,
            JSON.stringify(results, null, 2)
          )
          log.info('Downloaded Anthropic batch results', {
            senderId,
            batchId,
            anthropicBatchId,
            resultCount: results.length
          })
        } catch (error) {
          log.error('Failed to download Anthropic results', { senderId, batchId, anthropicBatchId, error })
        }
      }
    } else if (batchStatus.processing_status === 'canceling') {
      updatedManifest.status = 'cancelled'
    }

    saveManifest(senderId, batchId, updatedManifest)

    log.info('Checked Anthropic batch status', {
      senderId,
      batchId,
      anthropicBatchId,
      processingStatus: batchStatus.processing_status,
      requestCounts: batchStatus.request_counts
    })

    const requestCounts = batchStatus.request_counts

    return {
      batchId,
      providerBatchId: anthropicBatchId,
      status: batchStatus.processing_status,
      provider: 'anthropic',
      requestCounts: requestCounts
        ? {
            total:
              (requestCounts.processing ?? 0) +
              (requestCounts.succeeded ?? 0) +
              (requestCounts.errored ?? 0) +
              (requestCounts.canceled ?? 0) +
              (requestCounts.expired ?? 0),
            completed: requestCounts.succeeded ?? 0,
            failed: requestCounts.errored ?? 0,
            processing: requestCounts.processing,
            cancelled: requestCounts.canceled,
            expired: requestCounts.expired
          }
        : undefined,
      resultsUrl: batchStatus.results_url ?? undefined
    }
  } catch (error) {
    log.error('Failed to check Anthropic batch status', { senderId, batchId, anthropicBatchId, error })
    throw error
  }
}

/**
 * Cancel a batch that is currently processing
 */
export async function cancelBatch(options: CheckBatchStatusOptions): Promise<CheckBatchStatusResult> {
  const { senderId, batchId } = options
  const { providerConfig } = getAnthropicProviderInfo()
  const client = createAnthropicClient(providerConfig)

  const manifest = loadManifest(senderId, batchId)

  if (!manifest.anthropic?.batchId) {
    throw new Error(`Batch ${batchId} has not been submitted to Anthropic`)
  }

  const anthropicBatchId = manifest.anthropic.batchId

  try {
    const batchStatus = await client.messages.batches.cancel(anthropicBatchId)

    const updatedManifest: BatchManifest = {
      ...manifest,
      status: 'cancelled',
      anthropic: {
        ...manifest.anthropic,
        status: batchStatus.processing_status,
        processingStatus: batchStatus.processing_status
      },
      updatedAt: new Date().toISOString()
    }

    saveManifest(senderId, batchId, updatedManifest)

    log.info('Cancelled Anthropic batch', {
      senderId,
      batchId,
      anthropicBatchId,
      processingStatus: batchStatus.processing_status
    })

    const requestCounts = batchStatus.request_counts

    return {
      batchId,
      providerBatchId: anthropicBatchId,
      status: batchStatus.processing_status,
      provider: 'anthropic',
      requestCounts: requestCounts
        ? {
            total:
              (requestCounts.processing ?? 0) +
              (requestCounts.succeeded ?? 0) +
              (requestCounts.errored ?? 0) +
              (requestCounts.canceled ?? 0) +
              (requestCounts.expired ?? 0),
            completed: requestCounts.succeeded ?? 0,
            failed: requestCounts.errored ?? 0,
            processing: requestCounts.processing,
            cancelled: requestCounts.canceled,
            expired: requestCounts.expired
          }
        : undefined
    }
  } catch (error) {
    log.error('Failed to cancel Anthropic batch', { senderId, batchId, anthropicBatchId, error })
    throw error
  }
}
