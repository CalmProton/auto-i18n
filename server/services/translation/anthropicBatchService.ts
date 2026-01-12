/**
 * Anthropic Batch Service
 * Handles batch translation requests using Anthropic's Message Batches API
 * 
 * Anthropic's batch API differs from OpenAI in several key ways:
 * 1. Requests are sent directly as JSON (not JSONL files)
 * 2. Results are streamed via API (not file downloads)
 * 3. Processing status uses different terminology
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import { getTranslationConfig } from '../../config/env'
import { SUPPORTED_LOCALES } from '../../config/locales'
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildJsonTranslationPrompt,
  buildMarkdownTranslationPrompt,
  JSON_RESPONSE_DIRECTIVE,
  JSON_TRANSLATION_WRAPPER_DIRECTIVE,
  MARKDOWN_RESPONSE_DIRECTIVE
} from './prompts'
import { resolveUploadPath } from '../../utils/fileStorage'
import {
  batchFileExists,
  getBatchFilePath,
  readBatchFile,
  sanitizeBatchSegment,
  writeBatchFile
} from '../../utils/batchStorage'
import { createScopedLogger } from '../../utils/logger'
import type { TranslationFileType } from '../../types'
import { stringifyJson } from './providerShared'
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
  BatchRequestFormat,
  shouldIncludeFile
} from './batchTypes'
import { shouldIncludeFile as checkIncludeFile } from './batchTypes'

const log = createScopedLogger('translation:anthropicBatch')

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307'
const MANIFEST_FILE_NAME = 'manifest.json'
const INPUT_FILE_NAME = 'input.json' // Anthropic uses JSON, not JSONL
const BATCH_RESPONSE_NAME = 'anthropic-batch-response.json'

// Anthropic batch request format
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

function getAnthropicProviderInfo() {
  const config = getTranslationConfig()
  if (config.provider !== 'anthropic') {
    // Check if anthropic is available in providers list
    if (config.providers.anthropic) {
      return {
        model: config.providers.anthropic.model?.trim() || DEFAULT_ANTHROPIC_MODEL,
        providerConfig: config.providers.anthropic
      }
    }
    throw new Error('Anthropic provider must be configured to use batch processing')
  }
  const providerConfig = config.providerConfig
  if (!providerConfig) {
    throw new Error('Anthropic provider configuration is missing API key')
  }
  const resolvedModel = providerConfig.model?.trim() || DEFAULT_ANTHROPIC_MODEL
  return {
    model: resolvedModel,
    providerConfig
  }
}

function createAnthropicClient(providerConfig: { apiKey: string; baseUrl?: string }) {
  return new Anthropic({
    apiKey: providerConfig.apiKey,
    ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {})
  })
}

async function collectContentSources(directory: string, relativeFolder = ''): Promise<BatchSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const collected: BatchSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectContentSources(entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const fileStat = await stat(entryPath)
      const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      collected.push({
        type: 'content',
        format: 'markdown',
        folderPath: relativeFolder || undefined,
        filePath: entryPath,
        relativePath,
        fileName: entry.name,
        size: fileStat.size
      })
    }
  }

  return collected
}

async function collectJsonSources(
  type: Extract<BatchTranslationType, 'global' | 'page'>,
  directory: string,
  relativeFolder = ''
): Promise<BatchSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const collected: BatchSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectJsonSources(type, entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      const fileStat = await stat(entryPath)
      const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      collected.push({
        type,
        format: 'json',
        folderPath: relativeFolder || undefined,
        filePath: entryPath,
        relativePath,
        fileName: entry.name,
        size: fileStat.size
      })
    }
  }

  return collected
}

function getTargetLocales(sourceLocale: string, requested?: string[] | 'all'): string[] {
  const supported = new Set(SUPPORTED_LOCALES.map((locale) => locale.code))
  if (!supported.has(sourceLocale)) {
    throw new Error(`Source locale "${sourceLocale}" is not supported`)
  }
  const allTargets = Array.from(supported).filter((code) => code !== sourceLocale).sort()
  if (!requested || requested === 'all') {
    return allTargets
  }
  if (requested.length === 0) {
    return Array.from(supported).filter((code) => code !== sourceLocale).sort()
  }
  const normalized = requested.filter((code) => supported.has(code))
  const targets = normalized.filter((code) => code !== sourceLocale)
  if (targets.length === 0) {
    throw new Error('No valid target locales provided')
  }
  return Array.from(new Set(targets)).sort()
}

function buildCustomId(
  senderId: string,
  targetLocale: string,
  type: BatchTranslationType,
  relativePath: string,
  format: BatchRequestFormat
): string {
  const hash = createHash('sha1')
    .update(senderId)
    .update('\0')
    .update(targetLocale)
    .update('\0')
    .update(type)
    .update(relativePath)
    .digest('hex')
    .slice(0, 16)
  const pathFragment = sanitizeBatchSegment(relativePath.replace(/\//g, '_')).slice(-24)
  return `${format}_${type}_${targetLocale}_${hash}_${pathFragment}`
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

function loadManifest(senderId: string, batchId: string): BatchManifest {
  const content = readBatchFile(senderId, batchId, MANIFEST_FILE_NAME)
  const manifest = JSON.parse(content) as BatchManifest
  return manifest
}

function saveManifest(senderId: string, batchId: string, manifest: BatchManifest): void {
  const updated: BatchManifest = {
    ...manifest,
    updatedAt: new Date().toISOString()
  }
  writeBatchFile(senderId, batchId, MANIFEST_FILE_NAME, JSON.stringify(updated, null, 2))
}

/**
 * Create a batch for Anthropic Message Batches API
 */
export async function createBatch(options: CreateBatchOptions): Promise<CreateBatchResult> {
  const { senderId, sourceLocale, targetLocales: requestedTargets, includeFiles, types } = options

  const { model } = getAnthropicProviderInfo()

  const requestedTypes = types && types !== 'all' ? new Set<BatchTranslationType>(types) : null

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
    checkIncludeFile(source.type, source.relativePath, includeFiles)
  )

  if (filteredSources.length === 0) {
    throw new Error('No matching files were found to include in the batch')
  }

  const targetLocales = getTargetLocales(sourceLocale, requestedTargets)

  const markdownSources = filteredSources.filter((source) => source.format === 'markdown')
  const jsonSources = filteredSources.filter((source) => source.format === 'json')

  const markdownRequests =
    markdownSources.length > 0
      ? await buildMarkdownRequests({ senderId, sourceLocale, targetLocales, sources: markdownSources, model })
      : []

  const jsonRequests =
    jsonSources.length > 0
      ? await buildJsonRequests({ senderId, sourceLocale, targetLocales, sources: jsonSources, model })
      : []

  const requests = [...markdownRequests, ...jsonRequests]

  if (requests.length === 0) {
    throw new Error('Unable to generate any translation requests for the batch')
  }

  // Anthropic has a limit of 100,000 requests per batch
  if (requests.length > 100000) {
    throw new Error(`Batch size exceeds Anthropic limit of 100,000 requests (${requests.length} requests)`)
  }

  const batchId = `batch_anthropic_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`

  // Store requests as JSON array (Anthropic format)
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

  const sourceFileSummaries = filteredSources.map((source) => ({
    type: source.type,
    format: source.format,
    relativePath: source.relativePath,
    folderPath: source.folderPath,
    size: source.size
  }))

  const manifestTypes = Array.from(new Set(requests.map((request) => request.record.type))).sort()

  const manifest: BatchManifest = {
    batchId,
    senderId,
    provider: 'anthropic',
    types: manifestTypes,
    sourceLocale,
    targetLocales,
    model,
    totalRequests: requests.length,
    files: requests.map((request) => request.record),
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
    requestCount: requests.length,
    inputFilePath,
    sourceFiles: sourceFileSummaries
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
  const { senderId, batchId, metadata } = options
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

  // Read the requests from the input file
  const inputContent = readBatchFile(senderId, batchId, INPUT_FILE_NAME)
  const requests: AnthropicBatchRequest[] = JSON.parse(inputContent)

  // Submit to Anthropic Message Batches API
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

    // Update manifest with latest status
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

    // Map Anthropic status to our internal status
    if (batchStatus.processing_status === 'ended') {
      updatedManifest.status = 'completed'

      // Download results if available
      if (batchStatus.results_url) {
        try {
          // Stream results and save them
          const results: unknown[] = []
          // The results() method returns a Promise<JSONLDecoder> - await to get the decoder
          // then iterate over the async iterable JSONLDecoder
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

      // Update change session status if this is a change session batch
      try {
        const { loadChangeSession, updateChangeSessionStatus } = await import('../../utils/changeStorage')
        const changeSession = await loadChangeSession(senderId)

        if (changeSession) {
          await updateChangeSessionStatus(senderId, 'completed', {
            completed: {
              completed: true,
              timestamp: new Date().toISOString(),
              translationCount: batchStatus.request_counts?.succeeded
            }
          })
          log.info('✅ Change session batch completed', {
            senderId,
            completedRequests: batchStatus.request_counts?.succeeded,
            batchId
          })
        }
      } catch (error) {
        log.debug('Could not update change session (might not be a change session)', { senderId, error })
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

    return {
      batchId,
      providerBatchId: anthropicBatchId,
      status: batchStatus.processing_status,
      provider: 'anthropic',
      requestCounts: batchStatus.request_counts
        ? {
            total:
              (batchStatus.request_counts.processing ?? 0) +
              (batchStatus.request_counts.succeeded ?? 0) +
              (batchStatus.request_counts.errored ?? 0) +
              (batchStatus.request_counts.canceled ?? 0) +
              (batchStatus.request_counts.expired ?? 0),
            completed: batchStatus.request_counts.succeeded ?? 0,
            failed: batchStatus.request_counts.errored ?? 0,
            processing: batchStatus.request_counts.processing,
            cancelled: batchStatus.request_counts.canceled,
            expired: batchStatus.request_counts.expired
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

    return {
      batchId,
      providerBatchId: anthropicBatchId,
      status: batchStatus.processing_status,
      provider: 'anthropic',
      requestCounts: batchStatus.request_counts
        ? {
            total:
              (batchStatus.request_counts.processing ?? 0) +
              (batchStatus.request_counts.succeeded ?? 0) +
              (batchStatus.request_counts.errored ?? 0) +
              (batchStatus.request_counts.canceled ?? 0) +
              (batchStatus.request_counts.expired ?? 0),
            completed: batchStatus.request_counts.succeeded ?? 0,
            failed: batchStatus.request_counts.errored ?? 0,
            processing: batchStatus.request_counts.processing,
            cancelled: batchStatus.request_counts.canceled,
            expired: batchStatus.request_counts.expired
          }
        : undefined
    }
  } catch (error) {
    log.error('Failed to cancel Anthropic batch', { senderId, batchId, anthropicBatchId, error })
    throw error
  }
}

// Re-export types for convenience
export type {
  BatchManifest,
  BatchRequestRecord,
  CreateBatchOptions,
  CreateBatchResult,
  SubmitBatchOptions,
  SubmitBatchResult,
  CheckBatchStatusOptions,
  CheckBatchStatusResult
} from './batchTypes'
