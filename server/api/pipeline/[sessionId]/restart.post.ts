import { db, schema } from '../../../db'
import { eq } from 'drizzle-orm'
import { getSessionById, updateSession } from '../../../repositories/sessions'
import { enqueueJob } from '../../../queue'
import { getBatchProviderName } from '../../../services/translation'

/**
 * POST /api/pipeline/:sessionId/restart
 * Restart a failed pipeline by resetting jobs and re-enqueuing.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  if (session.status !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: `Session must be in 'failed' state to restart (current: ${session.status})` })
  }

  // Reset failed jobs to pending
  await db
    .update(schema.jobs)
    .set({ status: 'pending', attempts: 0, error: null })
    .where(eq(schema.jobs.sessionId, sessionId))

  await updateSession(sessionId, { status: 'processing' })

  // Re-enqueue translation
  const batchProvider = await getBatchProviderName()
  if (batchProvider) {
    const { createBatchFromSession, submitBatch } = await import('../../../services/translation/batchService')
    const batchDbId = await createBatchFromSession(sessionId)
    const externalId = await submitBatch(batchDbId)
    await enqueueJob(sessionId, 'batch-poll', undefined, new Date(Date.now() + 30_000))
    return { sessionId, status: 'processing', mode: 'batch', externalId }
  } else {
    await enqueueJob(sessionId, 'realtime-translate')
    return { sessionId, status: 'processing', mode: 'realtime' }
  }
})
