import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import OpenAI from 'openai'
import { getTranslationConfig } from '../../config/env'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { TRANSLATION_SYSTEM_PROMPT, buildMarkdownTranslationPrompt, MARKDOWN_RESPONSE_DIRECTIVE } from './prompts'
import { resolveOpenAIModel } from './providers/openaiProvider'
import { resolveUploadPath } from '../../utils/fileStorage'
import { batchFileExists, getBatchFilePath, readBatchFile, sanitizeBatchSegment, writeBatchFile } from '../../utils/batchStorage'
import { createScopedLogger } from '../../utils/logger'

const log = createScopedLogger('translation:openaiBatch')

export type BatchContentType = 'content'
export type BatchStatus = 'draft' | 'submitted' | 'completed' | 'failed'

export interface BatchRequestRecord {
  customId: string
  type: 'markdown'
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
  type: BatchContentType
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

export interface CreateContentBatchOptions {
  senderId: string
  sourceLocale: string
  targetLocales?: string[]
  includeFiles?: string[]
}

export interface CreateContentBatchResult {
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

type ContentSourceFile = {
  folderPath?: string
  filePath: string
  relativePath: string
  fileName: string
  size: number
}

type MarkdownBatchRequest = {
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

async function collectContentSourceFiles(directory: string, relativeFolder = ''): Promise<ContentSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const collected: ContentSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectContentSourceFiles(entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const fileStat = await stat(entryPath)
      const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      collected.push({
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

function getTargetLocales(sourceLocale: string, requested?: string[]): string[] {
  const supported = new Set(SUPPORTED_LOCALES.map((locale) => locale.code))
  if (!supported.has(sourceLocale)) {
    throw new Error(`Source locale \\"${sourceLocale}\\" is not supported`)
  }
  if (!requested || requested.length === 0) {
    return Array.from(supported).filter((code) => code !== sourceLocale).sort()
  }
  const normalized = requested.filter((code) => supported.has(code))
  const targets = normalized.filter((code) => code !== sourceLocale)
  if (targets.length === 0) {
    throw new Error('No valid target locales provided')
  }
  return Array.from(new Set(targets)).sort()
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\+/g, '/').replace(/^\//, '')
}

function shouldIncludeFile(relativePath: string, includeFiles?: string[]): boolean {
  if (!includeFiles || includeFiles.length === 0) {
    return true
  }
  const normalized = normalizeRelativePath(relativePath)
  return includeFiles.some((entry) => normalizeRelativePath(entry) === normalized)
}

function buildCustomId(senderId: string, targetLocale: string, relativePath: string): string {
  const hash = createHash('sha1')
    .update(senderId)
    .update('\0')
    .update(targetLocale)
    .update('\0')
    .update(relativePath)
    .digest('hex')
    .slice(0, 16)
  const pathFragment = sanitizeBatchSegment(relativePath.replace(/\//g, '_')).slice(-24)
  return `markdown_${targetLocale}_${hash}_${pathFragment}`
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

async function buildMarkdownRequests(options: {
  senderId: string
  sourceLocale: string
  targetLocales: string[]
  sources: ContentSourceFile[]
  model: string
}): Promise<MarkdownBatchRequest[]> {
  const { senderId, sourceLocale, targetLocales, sources, model } = options
  const requests: MarkdownBatchRequest[] = []

  for (const source of sources) {
    const content = await Bun.file(source.filePath).text()
    for (const targetLocale of targetLocales) {
      const instruction = buildMarkdownTranslationPrompt(sourceLocale, targetLocale)
      const customId = buildCustomId(senderId, targetLocale, source.relativePath)
      requests.push({
        customId,
        body: buildMarkdownRequestBody({ model, instruction, content }),
        record: {
          customId,
          type: 'markdown',
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

function serializeJsonl(requests: MarkdownBatchRequest[]): string {
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

export async function createContentBatch(options: CreateContentBatchOptions): Promise<CreateContentBatchResult> {
  const { senderId, sourceLocale, targetLocales: requestedTargets, includeFiles } = options

  const { model } = getOpenAIProviderInfo()

  const uploadRoot = resolveUploadPath({ senderId, locale: sourceLocale, type: 'content', category: 'uploads' })
  const sources = await collectContentSourceFiles(uploadRoot)
  const filteredSources = sources.filter((source) => shouldIncludeFile(source.relativePath, includeFiles))

  if (filteredSources.length === 0) {
    throw new Error('No markdown files were found to include in the batch')
  }

  const targetLocales = getTargetLocales(sourceLocale, requestedTargets)
  const requests = await buildMarkdownRequests({ senderId, sourceLocale, targetLocales, sources: filteredSources, model })

  if (requests.length === 0) {
    throw new Error('Unable to generate any translation requests for the batch')
  }

  const batchId = `batch_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`
  const inputFilePath = writeBatchFile(senderId, batchId, INPUT_FILE_NAME, serializeJsonl(requests))

  const manifest: BatchManifest = {
    batchId,
    senderId,
    type: 'content',
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
    targetLocales,
    fileCount: filteredSources.length,
    requestCount: requests.length,
    inputFilePath
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
      type: manifest.type,
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
