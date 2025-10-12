import { Elysia } from 'elysia'
import { finalizeTranslationJob } from '../services/github/workflow'
import type { ErrorResponse, TranslationMetadataUpdate } from '../types'
import { createScopedLogger } from '../utils/logger'

const githubRoutes = new Elysia({ prefix: '/github' })
const log = createScopedLogger('routes:github')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

githubRoutes.post('/finalize', async ({ body, query, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const senderId = typeof payload.senderId === 'string' ? payload.senderId : query.senderId

    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'senderId is required' }
      return errorResponse
    }

    const metadataUpdate = isRecord(payload.metadata) ? payload.metadata as TranslationMetadataUpdate : undefined
    const jobId = typeof payload.jobId === 'string' ? payload.jobId : undefined
    const dryRun = payload.dryRun === true

    log.info('Received finalize request', {
      senderId,
      dryRun,
      metadataProvided: Boolean(metadataUpdate),
      jobId
    })

    const result = await finalizeTranslationJob({ senderId, metadataUpdate, jobId, dryRun })

    return {
      message: 'GitHub synchronization complete',
      senderId,
      result
    }
  } catch (error) {
    log.error('Failed to finalize translation job', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Failed to finalize translation job'
    }
    return errorResponse
  }
})

export default githubRoutes
