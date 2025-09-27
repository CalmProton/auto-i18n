import { Hono } from 'hono'
import { finalizeTranslationJob } from '../services/github/workflow'
import type { ErrorResponse } from '../types'
import { createScopedLogger } from '../utils/logger'

const githubRoutes = new Hono()
const log = createScopedLogger('routes:github')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

githubRoutes.post('/finalize', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const senderId = typeof body.senderId === 'string' ? body.senderId : c.req.query('senderId')

    if (!senderId) {
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return c.json(errorResponse, 400)
    }

    const metadata = isRecord(body.metadata) ? body.metadata : undefined
    const dryRun = body.dryRun === true

    log.info('Received finalize request', {
      senderId,
      dryRun,
      metadataProvided: Boolean(metadata)
    })

    const result = await finalizeTranslationJob({ senderId, metadata: metadata as any, dryRun })

    return c.json({
      message: 'GitHub synchronization complete',
      senderId,
      result
    })
  } catch (error) {
    log.error('Failed to finalize translation job', { error })
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Failed to finalize translation job'
    }
    return c.json(errorResponse, 500)
  }
})

export default githubRoutes
