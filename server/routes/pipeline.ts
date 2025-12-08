import { Elysia, type Context } from 'elysia'
import type { ErrorResponse } from '../types'
import { createScopedLogger } from '../utils/logger'
import { isMockModeEnabled, getTranslationConfig } from '../config/env'
import {
  getPipelineEventsBySenderId,
  getPipelineEventById,
  getApiRequestLogsBySenderId,
  getApiRequestLogById,
  getPipelineStatsBySenderId,
  deleteOldPipelineEvents,
  deleteOldApiRequestLogs,
  clearSessionLogs,
} from '../repositories/pipelineRepository'
import { getSessionBySenderId } from '../repositories/sessionRepository'

const pipelineRoutes = new Elysia({ prefix: '/api/pipeline' })
const log = createScopedLogger('routes:pipeline')

// Type helper for route context
type RouteContext = {
  params: Record<string, string>
  query: Record<string, string | undefined>
  body: unknown
  set: { status?: number }
}

/**
 * GET /api/pipeline/mode
 * Get current translation mode info
 */
pipelineRoutes.get('/mode', async (ctx: RouteContext) => {
  try {
    const mockEnabled = isMockModeEnabled()
    const config = getTranslationConfig()
    
    return {
      provider: config.provider,
      isMockMode: mockEnabled,
      globalMockEnabled: mockEnabled,
      message: mockEnabled
        ? 'Mock mode is enabled - translations will return placeholder strings'
        : `Production mode - using ${config.provider} provider`
    }
  } catch (error) {
    log.error('Failed to get pipeline mode', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to get pipeline mode' }
    return errorResponse
  }
})

/**
 * GET /api/pipeline/:senderId/events
 * Get pipeline events for a sender
 */
pipelineRoutes.get('/:senderId/events', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : 100
    const offset = ctx.query.offset ? parseInt(ctx.query.offset, 10) : 0

    log.debug('Fetching pipeline events', { senderId, limit, offset })

    const rawEvents = await getPipelineEventsBySenderId(senderId, { limit, offset })
    
    // Transform events for frontend - don't include large request/response data in list view
    const events = rawEvents.map(event => ({
      id: event.id,
      step: event.step,
      status: event.status,
      message: event.message,
      durationMs: event.durationMs,
      batchId: event.batchId,
      jobId: event.jobId,
      createdAt: event.createdAt,
      hasRequestData: !!event.requestData,
      hasResponseData: !!event.responseData,
      hasErrorData: !!event.errorData,
    }))

    return {
      success: true,
      senderId,
      events,
      total: events.length
    }
  } catch (error) {
    log.error('Failed to get pipeline events', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to get pipeline events' }
  }
})

/**
 * GET /api/pipeline/:senderId/events/:eventId
 * Get a single pipeline event with full details
 */
pipelineRoutes.get('/:senderId/events/:eventId', async (ctx: RouteContext) => {
  try {
    const { senderId, eventId } = ctx.params
    
    if (!senderId || !eventId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId and eventId are required' }
    }

    log.debug('Fetching pipeline event detail', { senderId, eventId })

    const event = await getPipelineEventById(eventId)
    
    if (!event) {
      ctx.set.status = 404
      return { success: false, error: 'Event not found' }
    }

    return {
      success: true,
      event: {
        id: event.id,
        step: event.step,
        status: event.status,
        message: event.message,
        durationMs: event.durationMs,
        batchId: event.batchId,
        jobId: event.jobId,
        createdAt: event.createdAt,
        requestData: event.requestData,
        responseData: event.responseData,
        errorData: event.errorData,
      }
    }
  } catch (error) {
    log.error('Failed to get pipeline event detail', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to get pipeline event detail' }
  }
})

/**
 * GET /api/pipeline/:senderId/logs
 * Get API request logs for a sender
 */
pipelineRoutes.get('/:senderId/logs', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : 100
    const offset = ctx.query.offset ? parseInt(ctx.query.offset, 10) : 0

    log.debug('Fetching API request logs', { senderId, limit, offset })

    const rawLogs = await getApiRequestLogsBySenderId(senderId, { limit, offset })
    
    // Transform logs for frontend - don't include large request/response data in list view
    const logs = rawLogs.map(logEntry => ({
      id: logEntry.id,
      provider: logEntry.provider,
      endpoint: logEntry.endpoint,
      method: logEntry.method,
      responseStatus: logEntry.responseStatus,
      durationMs: logEntry.durationMs,
      filePath: logEntry.filePath,
      sourceLocale: logEntry.sourceLocale,
      targetLocale: logEntry.targetLocale,
      isMock: logEntry.isMock === 'true',
      createdAt: logEntry.createdAt,
      hasError: !!logEntry.errorMessage,
    }))

    return {
      success: true,
      senderId,
      logs,
      total: logs.length
    }
  } catch (error) {
    log.error('Failed to get API request logs', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to get API request logs' }
  }
})

/**
 * GET /api/pipeline/:senderId/logs/:logId
 * Get a single API request log with full details
 */
pipelineRoutes.get('/:senderId/logs/:logId', async (ctx: RouteContext) => {
  try {
    const { senderId, logId } = ctx.params
    
    if (!senderId || !logId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId and logId are required' }
    }

    log.debug('Fetching API request log detail', { senderId, logId })

    const logEntry = await getApiRequestLogById(logId)
    
    if (!logEntry) {
      ctx.set.status = 404
      return { success: false, error: 'Log entry not found' }
    }

    return {
      success: true,
      log: {
        id: logEntry.id,
        provider: logEntry.provider,
        endpoint: logEntry.endpoint,
        method: logEntry.method,
        responseStatus: logEntry.responseStatus,
        durationMs: logEntry.durationMs,
        filePath: logEntry.filePath,
        sourceLocale: logEntry.sourceLocale,
        targetLocale: logEntry.targetLocale,
        isMock: logEntry.isMock === 'true',
        createdAt: logEntry.createdAt,
        requestHeaders: logEntry.requestHeaders,
        requestBody: logEntry.requestBody,
        responseHeaders: logEntry.responseHeaders,
        responseBody: logEntry.responseBody,
        errorMessage: logEntry.errorMessage,
        errorStack: logEntry.errorStack,
      }
    }
  } catch (error) {
    log.error('Failed to get API request log detail', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to get API request log detail' }
  }
})

/**
 * GET /api/pipeline/:senderId/stats
 * Get pipeline statistics for a sender
 */
pipelineRoutes.get('/:senderId/stats', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    log.debug('Fetching pipeline stats', { senderId })

    const counts = await getPipelineStatsBySenderId(senderId)

    return {
      success: true,
      senderId,
      counts
    }
  } catch (error) {
    log.error('Failed to get pipeline stats', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to get pipeline stats' }
  }
})

/**
 * DELETE /api/pipeline/:senderId/logs
 * Delete all logs for a sender session
 */
pipelineRoutes.delete('/:senderId/logs', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    log.info('Deleting logs for sender', { senderId })

    // Get session to get session ID
    const session = await getSessionBySenderId(senderId)
    if (!session) {
      ctx.set.status = 404
      return { success: false, error: 'Session not found' }
    }

    const result = await clearSessionLogs(session.id)

    return {
      success: true,
      senderId,
      deleted: {
        pipelineEvents: result.pipelineEventsDeleted,
        apiLogs: result.apiLogsDeleted,
      }
    }
  } catch (error) {
    log.error('Failed to delete logs', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to delete logs' }
  }
})

/**
 * POST /api/pipeline/:senderId/cancel
 * Cancel a running pipeline
 * TODO: Implement actual cancellation logic with BullMQ job cancellation
 */
pipelineRoutes.post('/:senderId/cancel', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    log.info('Cancelling pipeline', { senderId })

    // TODO: Implement actual cancellation logic
    // This would involve:
    // 1. Finding active BullMQ jobs for this senderId
    // 2. Cancelling them
    // 3. Updating pipeline events with cancelled status

    return {
      success: true,
      senderId,
      cancelled: true,
      message: 'Pipeline cancellation requested'
    }
  } catch (error) {
    log.error('Failed to cancel pipeline', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to cancel pipeline' }
  }
})

/**
 * POST /api/pipeline/:senderId/restart
 * Restart a pipeline from the beginning
 * TODO: Implement actual restart logic
 */
pipelineRoutes.post('/:senderId/restart', async (ctx: RouteContext) => {
  try {
    const senderId = ctx.params.senderId
    
    if (!senderId) {
      ctx.set.status = 400
      return { success: false, error: 'senderId is required' }
    }

    log.info('Restarting pipeline', { senderId })

    // TODO: Implement actual restart logic
    // This would involve:
    // 1. Cancelling any active jobs
    // 2. Clearing previous pipeline events
    // 3. Re-triggering the translation pipeline

    return {
      success: true,
      senderId,
      restarted: true,
      message: 'Pipeline restart requested'
    }
  } catch (error) {
    log.error('Failed to restart pipeline', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to restart pipeline' }
  }
})

/**
 * POST /api/pipeline/cleanup
 * Clean up old pipeline events and logs
 */
pipelineRoutes.post('/cleanup', async (ctx: RouteContext) => {
  try {
    const payload = typeof ctx.body === 'object' && ctx.body !== null ? ctx.body as Record<string, unknown> : {}
    
    // Default to 7 days if not specified
    const olderThanDays = typeof payload.olderThanDays === 'number' ? payload.olderThanDays : 7

    log.info('Cleaning up old pipeline data', { olderThanDays })

    const eventsDeleted = await deleteOldPipelineEvents(olderThanDays)
    const logsDeleted = await deleteOldApiRequestLogs(olderThanDays)

    return {
      success: true,
      cleaned: true,
      eventsDeleted,
      logsDeleted,
      message: `Cleaned up events older than ${olderThanDays} days`
    }
  } catch (error) {
    log.error('Failed to cleanup pipeline data', { error })
    ctx.set.status = 500
    return { success: false, error: 'Failed to cleanup pipeline data' }
  }
})

export { pipelineRoutes }
