import { Hono } from 'hono'
import { isSupportedLocale } from '../config/locales'
import type { ErrorResponse } from '../types'
import { createBatch, submitBatch } from '../services/translation/openaiBatchService'
import type { TranslationFileType } from '../types'
import { createScopedLogger } from '../utils/logger'

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

export default batchRoutes
