import { Elysia } from 'elysia'
import { isSupportedLocale } from '../config/locales'
import type { ErrorResponse } from '../types'
import { createBatch, submitBatch, createRetryBatch } from '../services/translation/openaiBatchService'
import type { TranslationFileType } from '../types'
import { createScopedLogger } from '../utils/logger'
import { processBatchOutput } from '../services/translation/batchOutputProcessor'
import { formatTranslationsForGithub, getTranslationSummary } from '../services/translation/translationFormatter'
import { readBatchFile, batchFileExists } from '../utils/batchStorage'

const batchRoutes = new Elysia({ prefix: '/translate/batch' })
const log = createScopedLogger('routes:batch')

batchRoutes.post('/', async ({ body, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null
    if (!payload) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'Request body is required' }
      return errorResponse
    }

    const senderId = typeof payload.senderId === 'string' ? payload.senderId.trim() : ''
    const sourceLocale = typeof payload.sourceLocale === 'string' ? payload.sourceLocale.trim() : ''
    const targetLocales = (() => {
      if (Array.isArray(payload.targetLocales)) {
        return payload.targetLocales
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }
      if (typeof payload.targetLocales === 'string') {
        const normalized = payload.targetLocales.trim().toLowerCase()
        if (normalized === 'all') {
          return 'all' as const
        }
        if (normalized.length > 0) {
          return [normalized]
        }
      }
      return undefined
    })()

    const includeFiles = (() => {
      if (Array.isArray(payload.includeFiles)) {
        return payload.includeFiles
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }
      if (typeof payload.includeFiles === 'string') {
        const normalized = payload.includeFiles.trim().toLowerCase()
        if (normalized === 'all') {
          return 'all' as const
        }
        if (normalized.length > 0) {
          return [normalized]
        }
      }
      return undefined
    })()

    const types = (() => {
      const allowedTypes: TranslationFileType[] = ['content', 'global', 'page']
      const isAllowed = (value: string): value is TranslationFileType =>
        allowedTypes.includes(value as TranslationFileType)
      if (Array.isArray(payload.types)) {
        const normalized = payload.types
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(isAllowed)
        return normalized.length > 0 ? normalized : undefined
      }
      if (typeof payload.types === 'string') {
        const normalized = payload.types.trim().toLowerCase()
        if (normalized === 'all') {
          return 'all' as const
        }
        if (isAllowed(normalized)) {
          return [normalized]
        }
      }
      return undefined
    })()

    log.info('Received batch creation request', {
      senderId,
      sourceLocale,
      targetLocales: targetLocales === 'all' ? 'all' : targetLocales,
      includeFiles: includeFiles === 'all' ? 'all' : includeFiles,
      includeFilesCount: includeFiles === 'all' ? 'all' : includeFiles?.length,
      types: types === 'all' ? 'all' : types
    })

    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    if (!sourceLocale || !isSupportedLocale(sourceLocale)) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: `Unsupported source locale "${sourceLocale || 'unknown'}"` }
      return errorResponse
    }

    const result = await createBatch({
      senderId,
      sourceLocale,
      targetLocales,
      includeFiles,
      types
    })

    set.status = 201
    return {
      message: 'Batch input file created successfully',
      batchId: result.batchId,
      requestCount: result.requestCount,
      manifest: result.manifest
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create batch input'
    const status = error instanceof Error && (
      message.toLowerCase().includes('no markdown files') ||
      message.toLowerCase().includes('no valid target locales') ||
      message.toLowerCase().includes('not supported')
    ) ? 400 : 500
    set.status = status
    log.error('Failed to create OpenAI batch input', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return errorResponse
  }
})

batchRoutes.post('/:batchId/submit', async ({ params, body, set }) => {
  try {
    const batchId = params.batchId
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null

    const senderId = (payload && typeof payload.senderId === 'string') ? payload.senderId.trim() : ''
    const metadata = payload && typeof payload.metadata === 'object' && payload.metadata && !Array.isArray(payload.metadata)
      ? Object.fromEntries(Object.entries(payload.metadata).filter(([key, value]) => typeof key === 'string' && typeof value === 'string'))
      : undefined

    log.info('Submitting batch for processing', {
      senderId,
      batchId,
      metadataKeys: metadata ? Object.keys(metadata) : []
    })

    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    if (!batchId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'batchId is required' }
      return errorResponse
    }

    const result = await submitBatch({ senderId, batchId, metadata })

    return {
      message: 'Batch submitted to OpenAI for processing',
      batchId: result.batchId,
      openaiBatchId: result.openaiBatchId,
      status: result.openaiStatus,
      inputFileId: result.inputFileId
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit batch'
    const status = error instanceof Error && message.toLowerCase().includes('no input file') ? 400 : 500
    set.status = status
    log.error('Failed to submit OpenAI batch', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return errorResponse
  }
})

/**
 * Process OpenAI batch output JSONL file
 * POST /batch/output
 * Body: { senderId: string, batchId: string, batchOutputId: string }
 */
batchRoutes.post('/output', async ({ body, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null

    const senderId = (payload && typeof payload.senderId === 'string') ? payload.senderId.trim() : ''
    const batchId = (payload && typeof payload.batchId === 'string') ? payload.batchId.trim() : ''
    const batchOutputId = (payload && typeof payload.batchOutputId === 'string') ? payload.batchOutputId.trim() : ''

    log.info('Processing batch output', {
      senderId,
      batchId,
      batchOutputId
    })

    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    if (!batchId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'batchId is required' }
      return errorResponse
    }

    if (!batchOutputId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'batchOutputId is required' }
      return errorResponse
    }

    // Step 1: Read the output file using the provided batch output ID
    const outputFileName = `${batchOutputId}.jsonl`
    
    if (!batchFileExists(senderId, batchId, outputFileName)) {
      set.status = 404
      const errorResponse: ErrorResponse = { error: `Output file not found: ${outputFileName}` }
      return errorResponse
    }

    const outputContent = readBatchFile(senderId, batchId, outputFileName)

    // Step 2: Parse batch output and extract translations
    const translations = await processBatchOutput({
      senderId,
      batchId,
      outputContent
    })

    // Step 3: Format and save translations to the translations directory
    const formatResult = await formatTranslationsForGithub({
      senderId,
      translations
    })

    // Step 4: Generate summary statistics
    const summary = getTranslationSummary(translations)

    return {
      message: 'Batch output processed successfully',
      batchId,
      senderId,
      totalTranslations: translations.length,
      savedFiles: formatResult.savedFiles,
      failedFiles: formatResult.failedFiles,
      summary: {
        byLocale: summary.byLocale,
        byType: summary.byType,
        totalSuccess: summary.totalSuccess,
        totalError: summary.totalError
      },
      errors: formatResult.errors.map(e => ({
        customId: e.translation.customId,
        targetLocale: e.translation.targetLocale,
        relativePath: e.translation.relativePath,
        error: e.error instanceof Error ? e.error.message : String(e.error)
      }))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process batch output'
    log.error('Failed to process batch output', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: message
    }
    return errorResponse
  }
})

/**
 * Create a retry batch from failed requests in an error file
 * POST /batch/retry
 * Body: { senderId: string, originalBatchId: string, errorFileName: string, model?: string }
 */
batchRoutes.post('/retry', async ({ body, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null

    const senderId = (payload && typeof payload.senderId === 'string') ? payload.senderId.trim() : ''
    const originalBatchId = (payload && typeof payload.originalBatchId === 'string') ? payload.originalBatchId.trim() : ''
    const errorFileName = (payload && typeof payload.errorFileName === 'string') ? payload.errorFileName.trim() : ''
    const model = (payload && typeof payload.model === 'string') ? payload.model.trim() : undefined

    log.info('Creating retry batch from failed requests', {
      senderId,
      originalBatchId,
      errorFileName,
      model
    })

    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    if (!originalBatchId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'originalBatchId is required' }
      return errorResponse
    }

    if (!errorFileName) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'errorFileName is required' }
      return errorResponse
    }

    const result = await createRetryBatch({
      senderId,
      originalBatchId,
      errorFileName,
      model
    })

    set.status = 201
    return {
      message: 'Retry batch created successfully',
      batchId: result.batchId,
      originalBatchId,
      requestCount: result.requestCount,
      failedRequestCount: result.failedRequestCount,
      model: result.manifest.model,
      manifest: result.manifest
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create retry batch'
    const status = error instanceof Error && (
      message.toLowerCase().includes('not found') ||
      message.toLowerCase().includes('no failed requests')
    ) ? 404 : 500
    set.status = status
    log.error('Failed to create retry batch', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return errorResponse
  }
})

export default batchRoutes
