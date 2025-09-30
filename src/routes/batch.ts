import { Hono } from 'hono'
import { isSupportedLocale } from '../config/locales'
import type { ErrorResponse } from '../types'
import { createContentBatch, submitBatch } from '../services/translation/openaiBatchService'
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
    const targetLocales = Array.isArray(body.targetLocales)
      ? body.targetLocales.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : undefined
    const includeFiles = Array.isArray(body.includeFiles)
      ? body.includeFiles.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : undefined

    log.info('Received batch creation request', {
      senderId,
      sourceLocale,
      targetLocales,
      includeFilesCount: includeFiles?.length
    })

    if (!senderId) {
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    if (!sourceLocale || !isSupportedLocale(sourceLocale)) {
      const errorResponse: ErrorResponse = { error: `Unsupported source locale "${sourceLocale || 'unknown'}"` }
      return c.json(errorResponse, 400)
    }

    const result = await createContentBatch({
      senderId,
      sourceLocale,
      targetLocales,
      includeFiles
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
