import { Elysia, type Context } from 'elysia'
import type { ErrorResponse } from '../types'
import { createScopedLogger } from '../utils/logger'
import { isMockModeEnabled } from '../config/env'
import {
  getPipelineEventsBySenderId,
  getApiRequestLogsBySenderId,
  deleteOldPipelineEvents,
  deleteOldApiRequestLogs,
} from '../repositories/pipelineRepository'

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
    return {
      mockEnabled,
      message: mockEnabled
        ? 'Mock mode is enabled - translations will return placeholder strings'
        : 'Production mode - translations will use configured AI provider'
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
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : 100
    const offset = ctx.query.offset ? parseInt(ctx.query.offset, 10) : 0

    log.debug('Fetching pipeline events', { senderId, limit, offset })

    const events = await getPipelineEventsBySenderId(senderId, { limit, offset })

    return {
      senderId,
      events,
      count: events.length
    }
  } catch (error) {
    log.error('Failed to get pipeline events', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to get pipeline events' }
    return errorResponse
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
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : 100
    const offset = ctx.query.offset ? parseInt(ctx.query.offset, 10) : 0

    log.debug('Fetching API request logs', { senderId, limit, offset })

    const logs = await getApiRequestLogsBySenderId(senderId, { limit, offset })

    return {
      senderId,
      logs,
      count: logs.length
    }
  } catch (error) {
    log.error('Failed to get API request logs', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to get API request logs' }
    return errorResponse
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
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    log.info('Cancelling pipeline', { senderId })

    // TODO: Implement actual cancellation logic
    // This would involve:
    // 1. Finding active BullMQ jobs for this senderId
    // 2. Cancelling them
    // 3. Updating pipeline events with cancelled status

    return {
      senderId,
      cancelled: true,
      message: 'Pipeline cancellation requested'
    }
  } catch (error) {
    log.error('Failed to cancel pipeline', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to cancel pipeline' }
    return errorResponse
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
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    log.info('Restarting pipeline', { senderId })

    // TODO: Implement actual restart logic
    // This would involve:
    // 1. Cancelling any active jobs
    // 2. Clearing previous pipeline events
    // 3. Re-triggering the translation pipeline

    return {
      senderId,
      restarted: true,
      message: 'Pipeline restart requested'
    }
  } catch (error) {
    log.error('Failed to restart pipeline', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to restart pipeline' }
    return errorResponse
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
      cleaned: true,
      eventsDeleted,
      logsDeleted,
      message: `Cleaned up events older than ${olderThanDays} days`
    }
  } catch (error) {
    log.error('Failed to cleanup pipeline data', { error })
    ctx.set.status = 500
    const errorResponse: ErrorResponse = { error: 'Failed to cleanup pipeline data' }
    return errorResponse
  }
})

export { pipelineRoutes }
