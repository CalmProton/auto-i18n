import { Hono } from 'hono'
import { isSupportedLocale } from '../config/locales'
import type { ErrorResponse } from '../types'
import { createBatch, submitBatch, createRetryBatch } from '../services/translation/openaiBatchService'
import type { TranslationFileType } from '../types'
import { createScopedLogger } from '../utils/logger'
import { processBatchOutput } from '../services/translation/batchOutputProcessor'
import { formatTranslationsForGithub, getTranslationSummary } from '../services/translation/translationFormatter'
import { readBatchFile, batchFileExists } from '../utils/batchStorage'

const batchRoutes = new Hono()
const log = createScopedLogger('routes:batch')

batchRoutes.post('/', async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      const errorResponse: ErrorResponse = { error: 'Request body is required' }
      return c.json(errorResponse, 400)
    }

    const senderId = typeof body.senderId === 'string' ? body.senderId.trim() : ''
    const sourceLocale = typeof body.sourceLocale === 'string' ? body.sourceLocale.trim() : ''
    const targetLocales = (() => {
      if (Array.isArray(body.targetLocales)) {
        return body.targetLocales
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }
      if (typeof body.targetLocales === 'string') {
        const normalized = body.targetLocales.trim().toLowerCase()
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
      if (Array.isArray(body.includeFiles)) {
        return body.includeFiles
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }
      if (typeof body.includeFiles === 'string') {
        const normalized = body.includeFiles.trim().toLowerCase()
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
      if (Array.isArray(body.types)) {
        const normalized = body.types
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(isAllowed)
        return normalized.length > 0 ? normalized : undefined
      }
      if (typeof body.types === 'string') {
        const normalized = body.types.trim().toLowerCase()
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
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    if (!sourceLocale || !isSupportedLocale(sourceLocale)) {
      const errorResponse: ErrorResponse = { error: `Unsupported source locale "${sourceLocale || 'unknown'}"` }
      return c.json(errorResponse, 400)
    }

    const result = await createBatch({
      senderId,
      sourceLocale,
      targetLocales,
      includeFiles,
      types
    })

    return c.json({
      message: 'Batch input file created successfully',
      batchId: result.batchId,
      requestCount: result.requestCount,
      manifest: result.manifest
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create batch input'
    const status = error instanceof Error && (
      message.toLowerCase().includes('no markdown files') ||
      message.toLowerCase().includes('no valid target locales') ||
      message.toLowerCase().includes('not supported')
    ) ? 400 : 500
    log.error('Failed to create OpenAI batch input', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return c.json(errorResponse, status)
  }
})

batchRoutes.post('/:batchId/submit', async (c) => {
  try {
    const batchId = c.req.param('batchId')
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

    const senderId = (body && typeof body.senderId === 'string') ? body.senderId.trim() : ''
    const metadata = body && typeof body.metadata === 'object' && body.metadata && !Array.isArray(body.metadata)
      ? Object.fromEntries(Object.entries(body.metadata).filter(([key, value]) => typeof key === 'string' && typeof value === 'string'))
      : undefined

    log.info('Submitting batch for processing', {
      senderId,
      batchId,
      metadataKeys: metadata ? Object.keys(metadata) : []
    })

    if (!senderId) {
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    if (!batchId) {
      const errorResponse: ErrorResponse = { error: 'batchId is required' }
      return c.json(errorResponse, 400)
    }

    const result = await submitBatch({ senderId, batchId, metadata })

    return c.json({
      message: 'Batch submitted to OpenAI for processing',
      batchId: result.batchId,
      openaiBatchId: result.openaiBatchId,
      status: result.openaiStatus,
      inputFileId: result.inputFileId
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit batch'
    const status = error instanceof Error && message.toLowerCase().includes('no input file') ? 400 : 500
    log.error('Failed to submit OpenAI batch', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return c.json(errorResponse, status)
  }
})

/**
 * Process OpenAI batch output JSONL file
 * POST /batch/output
 * Body: { senderId: string, batchId: string, batchOutputId: string }
 */
batchRoutes.post('/output', async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

    const senderId = (body && typeof body.senderId === 'string') ? body.senderId.trim() : ''
    const batchId = (body && typeof body.batchId === 'string') ? body.batchId.trim() : ''
    const batchOutputId = (body && typeof body.batchOutputId === 'string') ? body.batchOutputId.trim() : ''

    log.info('Processing batch output', {
      senderId,
      batchId,
      batchOutputId
    })

    if (!senderId) {
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    if (!batchId) {
      const errorResponse: ErrorResponse = { error: 'batchId is required' }
      return c.json(errorResponse, 400)
    }

    if (!batchOutputId) {
      const errorResponse: ErrorResponse = { error: 'batchOutputId is required' }
      return c.json(errorResponse, 400)
    }

    // Step 1: Read the output file using the provided batch output ID
    const outputFileName = `${batchOutputId}.jsonl`
    
    if (!batchFileExists(senderId, batchId, outputFileName)) {
      const errorResponse: ErrorResponse = { error: `Output file not found: ${outputFileName}` }
      return c.json(errorResponse, 404)
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

    return c.json({
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
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process batch output'
    log.error('Failed to process batch output', { error })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return c.json(errorResponse, 500)
  }
})

/**
 * Create a retry batch from failed requests in an error file
 * POST /batch/retry
 * Body: { senderId: string, originalBatchId: string, errorFileName: string, model?: string }
 */
batchRoutes.post('/retry', async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

    const senderId = (body && typeof body.senderId === 'string') ? body.senderId.trim() : ''
    const originalBatchId = (body && typeof body.originalBatchId === 'string') ? body.originalBatchId.trim() : ''
    const errorFileName = (body && typeof body.errorFileName === 'string') ? body.errorFileName.trim() : ''
    const model = (body && typeof body.model === 'string') ? body.model.trim() : undefined

    log.info('Creating retry batch from failed requests', {
      senderId,
      originalBatchId,
      errorFileName,
      model
    })

    if (!senderId) {
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    if (!originalBatchId) {
      const errorResponse: ErrorResponse = { error: 'originalBatchId is required' }
      return c.json(errorResponse, 400)
    }

    if (!errorFileName) {
      const errorResponse: ErrorResponse = { error: 'errorFileName is required' }
      return c.json(errorResponse, 400)
    }

    const result = await createRetryBatch({
      senderId,
      originalBatchId,
      errorFileName,
      model
    })

    return c.json({
      message: 'Retry batch created successfully',
      batchId: result.batchId,
      originalBatchId,
      requestCount: result.requestCount,
      failedRequestCount: result.failedRequestCount,
      model: result.manifest.model,
      manifest: result.manifest
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create retry batch'
    const status = error instanceof Error && (
      message.toLowerCase().includes('not found') ||
      message.toLowerCase().includes('no failed requests')
    ) ? 404 : 500
    log.error('Failed to create retry batch', { error, status })
    const errorResponse: ErrorResponse = {
      error: message
    }
    return c.json(errorResponse, status)
  }
})

export default batchRoutes
