import { getSessionById } from '../../../repositories/sessions'
import { getBatchBySession } from '../../../repositories/batches'
import { submitBatch } from '../../../services/translation/batchService'
import { enqueueJob } from '../../../queue'

/**
 * POST /api/batch/:sessionId/retry
 * Retry a failed batch: re-submit to the provider and re-enqueue polling.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const batch = await getBatchBySession(sessionId)
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'No batch found for session' })

  if (batch.status !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: `Batch is not in failed state (current: ${batch.status})` })
  }

  const externalId = await submitBatch(batch.id)
  await enqueueJob(sessionId, 'batch-poll', undefined, new Date(Date.now() + 30_000))

  return { batchId: batch.id, sessionId, status: 'submitted', externalId }
})
