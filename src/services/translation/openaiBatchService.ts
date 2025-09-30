import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import OpenAI from 'openai'
import { getTranslationConfig } from '../../config/env'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { TRANSLATION_SYSTEM_PROMPT, buildJsonTranslationPrompt, buildMarkdownTranslationPrompt, JSON_RESPONSE_DIRECTIVE, JSON_TRANSLATION_WRAPPER_DIRECTIVE, MARKDOWN_RESPONSE_DIRECTIVE } from './prompts'
import { resolveOpenAIModel } from './providers/openaiProvider'
import { resolveUploadPath } from '../../utils/fileStorage'
import { batchFileExists, getBatchFilePath, readBatchFile, sanitizeBatchSegment, writeBatchFile } from '../../utils/batchStorage'
import { createScopedLogger } from '../../utils/logger'
import type { TranslationFileType } from '../../types'
import { stringifyJson } from './providerShared'

const log = createScopedLogger('translation:openaiBatch')

export type BatchTranslationType = TranslationFileType
export type BatchRequestFormat = 'markdown' | 'json'
export type BatchStatus = 'draft' | 'submitted' | 'completed' | 'failed'

export interface BatchRequestRecord {
  customId: string
  type: BatchTranslationType
  format: BatchRequestFormat
  relativePath: string
  sourceLocale: string
  targetLocale: string
  folderPath?: string
  fileName: string
  size: number
}

export interface BatchManifest {
  batchId: string
  senderId: string
  types: BatchTranslationType[]
  sourceLocale: string
  targetLocales: string[]
  model: string
  totalRequests: number
  files: BatchRequestRecord[]
  status: BatchStatus
  createdAt: string
  updatedAt: string
  openai?: {
    inputFileId?: string
    batchId?: string
    endpoint?: string
    status?: string
    submissionTimestamp?: string
  }
}

export interface CreateBatchOptions {
  senderId: string
  sourceLocale: string
  targetLocales?: string[] | 'all'
  includeFiles?: string[] | 'all'
  types?: BatchTranslationType[] | 'all'
}

export interface CreateBatchResult {
  batchId: string
  requestCount: number
  manifest: BatchManifest
  inputFilePath: string
}

export interface SubmitBatchOptions {
  senderId: string
  batchId: string
  metadata?: Record<string, string>
}

export interface SubmitBatchResult {
  batchId: string
  openaiBatchId: string
  openaiStatus: string
  inputFileId: string
}

type BatchSourceFile = {
  type: BatchTranslationType
  format: BatchRequestFormat
  folderPath?: string
  filePath: string
  relativePath: string
  fileName: string
  size: number
}

type BatchRequest = {
  format: BatchRequestFormat
  customId: string
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  record: BatchRequestRecord
}

const REQUEST_ENDPOINT = '/v1/chat/completions'
const COMPLETION_WINDOW = '24h'
const INPUT_FILE_NAME = 'input.jsonl'
const MANIFEST_FILE_NAME = 'manifest.json'
const FILE_UPLOAD_RESPONSE_NAME = 'upload-response.json'
const BATCH_RESPONSE_NAME = 'openai-batch-response.json'

function getOpenAIProviderInfo() {
  const config = getTranslationConfig()
  if (config.provider !== 'openai') {
    throw new Error('OpenAI provider must be configured to use batch processing')
  }
  const providerConfig = config.providerConfig
  if (!providerConfig) {
    throw new Error('OpenAI provider configuration is missing api key')
  }
  const resolvedModel = resolveOpenAIModel(providerConfig)
  return {
    model: resolvedModel,
    providerConfig
  }
}

function createOpenAIClient(providerConfig: { apiKey: string; baseUrl?: string }) {
  return new OpenAI({
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

async function collectJsonSources(type: Extract<BatchTranslationType, 'global' | 'page'>, directory: string, relativeFolder = ''): Promise<BatchSourceFile[]> {
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
    throw new Error(`Source locale \\"${sourceLocale}\\" is not supported`)
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

function normalizeDescriptor(value: string): string {
  return value.replace(/\\+/g, '/').replace(/^\/+/, '').trim()
}

function shouldIncludeFile(type: BatchTranslationType, relativePath: string, includeFiles?: string[] | 'all'): boolean {
  if (!includeFiles || includeFiles === 'all' || includeFiles.length === 0) {
    return true
  }
  const normalizedRelative = normalizeDescriptor(relativePath)
  const candidates = new Set([
    normalizedRelative,
    `${type}/${normalizedRelative}`,
    `${type}:${normalizedRelative}`
  ])

  return includeFiles.some((entry) => {
    const trimmed = typeof entry === 'string' ? entry.trim() : String(entry)
    if (candidates.has(trimmed)) {
      return true
    }
    return candidates.has(normalizeDescriptor(trimmed))
  })
}

function buildCustomId(senderId: string, targetLocale: string, type: BatchTranslationType, relativePath: string, format: BatchRequestFormat): string {
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

function buildMarkdownRequestBody(options: {
  model: string
  instruction: string
  content: string
}): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const { model, instruction, content } = options
  return {
    model,
    messages: [
      {
        role: 'system' as const,
        content: TRANSLATION_SYSTEM_PROMPT
      },
      {
        role: 'user' as const,
        content: `${instruction}\n\n---\n${content}\n---\n\n${MARKDOWN_RESPONSE_DIRECTIVE}`
      }
    ],
    temperature: 1,
    max_completion_tokens: 16384
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
      {
        role: 'system' as const,
        content: TRANSLATION_SYSTEM_PROMPT
      },
      {
        role: 'user' as const,
        content: `${instruction}\n\nInput JSON:\n${stringifyJson(data)}\n\n${JSON_TRANSLATION_WRAPPER_DIRECTIVE}\n${JSON_RESPONSE_DIRECTIVE}`
      }
    ],
    temperature: 1,
    max_completion_tokens: 16384,
    response_format: {
      type: 'json_object'
    }
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

export async function createBatch(options: CreateBatchOptions): Promise<CreateBatchResult> {
  const { senderId, sourceLocale, targetLocales: requestedTargets, includeFiles, types } = options

  const { model } = getOpenAIProviderInfo()

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

  const filteredSources = sources.filter((source) => shouldIncludeFile(source.type, source.relativePath, includeFiles))

  if (filteredSources.length === 0) {
    throw new Error('No matching files were found to include in the batch')
  }

  const targetLocales = getTargetLocales(sourceLocale, requestedTargets)

  const markdownSources = filteredSources.filter((source) => source.format === 'markdown')
  const jsonSources = filteredSources.filter((source) => source.format === 'json')

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

  const batchId = `batch_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`
  const inputFilePath = writeBatchFile(senderId, batchId, INPUT_FILE_NAME, serializeJsonl(requests))

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

  log.info('Created OpenAI batch input', {
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
    inputFilePath
  }
}

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
    openaiBatchId: batchResponse.id,
    openaiStatus: batchResponse.status,
    inputFileId: fileResponse.id
  }
}
