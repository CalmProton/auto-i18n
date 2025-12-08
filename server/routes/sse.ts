/**
 * SSE (Server-Sent Events) Routes
 * Real-time event streaming for pipeline updates
 */
import { Elysia, t } from 'elysia'
import { subscribe, Channels } from '../cache'
import { getSessionBySenderId } from '../repositories/sessionRepository'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('routes:sse')

// Track active SSE connections
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>()

/**
 * Add a controller to the active connections for a senderId
 */
function addConnection(senderId: string, controller: ReadableStreamDefaultController): void {
  if (!activeConnections.has(senderId)) {
    activeConnections.set(senderId, new Set())
  }
  activeConnections.get(senderId)!.add(controller)
  log.debug('SSE connection added', { senderId, total: activeConnections.get(senderId)!.size })
}

/**
 * Remove a controller from active connections
 */
function removeConnection(senderId: string, controller: ReadableStreamDefaultController): void {
  const connections = activeConnections.get(senderId)
  if (connections) {
    connections.delete(controller)
    if (connections.size === 0) {
      activeConnections.delete(senderId)
    }
    log.debug('SSE connection removed', { senderId, remaining: connections?.size ?? 0 })
  }
}

/**
 * Send an event to all connections for a senderId
 */
function broadcastToSender(senderId: string, event: string, data: unknown): void {
  const connections = activeConnections.get(senderId)
  if (!connections || connections.size === 0) {
    return
  }

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoder = new TextEncoder()
  const encodedMessage = encoder.encode(message)

  for (const controller of connections) {
    try {
      controller.enqueue(encodedMessage)
    } catch (error) {
      log.warn('Failed to send SSE message', { senderId, error })
      connections.delete(controller)
    }
  }
}

/**
 * Initialize pub/sub subscription for broadcasting
 */
let subscriptionInitialized = false

async function initializeSubscription(): Promise<void> {
  if (subscriptionInitialized) {
    return
  }

  subscriptionInitialized = true

  try {
    // Subscribe to translation progress events
    await subscribe(Channels.translationProgress, (message) => {
      try {
        const event = typeof message === 'string' ? JSON.parse(message) : message
        if (event.senderId) {
          broadcastToSender(event.senderId, 'pipeline-event', event)
        }
      } catch (error) {
        log.error('Failed to process translation progress event', { error })
      }
    })

    // Subscribe to batch status changes
    await subscribe(Channels.batchStatusChanged, (message) => {
      try {
        const event = typeof message === 'string' ? JSON.parse(message) : message
        if (event.senderId) {
          broadcastToSender(event.senderId, 'batch-status', event)
        }
      } catch (error) {
        log.error('Failed to process batch status event', { error })
      }
    })

    log.info('SSE pub/sub subscriptions initialized')
  } catch (error) {
    log.error('Failed to initialize SSE subscriptions', { error })
    subscriptionInitialized = false
  }
}

// Type helper for route context
type SSERouteContext = {
  params: { senderId: string }
  set: { status?: number; headers?: Record<string, string> }
}

export const sseRoutes = new Elysia({ prefix: '/api/sse' })
  /**
   * SSE endpoint for pipeline events
   */
  .get(
    '/pipeline/:senderId',
    async (ctx: SSERouteContext) => {
      const { senderId } = ctx.params

      // Verify session exists
      const session = await getSessionBySenderId(senderId)
      if (!session) {
        ctx.set.status = 404
        return { error: 'Session not found' }
      }

      // Initialize subscriptions if needed
      await initializeSubscription()

      // Create SSE stream
      const stream = new ReadableStream({
        start(controller) {
          // Add to active connections
          addConnection(senderId, controller)

          // Send initial connection message
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode(`event: connected\ndata: ${JSON.stringify({ senderId, timestamp: new Date().toISOString() })}\n\n`)
          )

          // Send heartbeat every 30 seconds
          const heartbeatInterval = setInterval(() => {
            try {
              controller.enqueue(
                encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`)
              )
            } catch {
              clearInterval(heartbeatInterval)
            }
          }, 30000)

          // Cleanup on close
          return () => {
            clearInterval(heartbeatInterval)
            removeConnection(senderId, controller)
          }
        },
        cancel() {
          log.debug('SSE stream cancelled', { senderId })
        },
      })

      // Set SSE headers
      ctx.set.headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      }

      return stream
    },
    {
      params: t.Object({
        senderId: t.String(),
      }),
    }
  )

  /**
   * Get SSE connection stats
   */
  .get('/stats', () => {
    const stats: Record<string, number> = {}
    for (const [senderId, connections] of activeConnections) {
      stats[senderId] = connections.size
    }

    return {
      totalConnections: Array.from(activeConnections.values()).reduce((sum, set) => sum + set.size, 0),
      bySenderId: stats,
    }
  })
