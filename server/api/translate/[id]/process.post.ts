import { getSessionById, updateSession } from '../../../repositories/sessions'
import { getBatchProviderName } from '../../../services/translation'
import { createBatchFromSession, submitBatch } from '../../../services/translation/batchService'
import { enqueueJob } from '../../../queue'
import { eventStart } from '../../../repositories/events'

/**
 * POST /api/translate/:id/process
 * Process a changes session — runs translation (realtime or batch) on the uploaded delta files.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await getSessionById(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  if (session.sessionType !== 'changes') {
    throw createError({ statusCode: 400, statusMessage: 'Only changes sessions can be processed via this endpoint' })
  }

  if (session.status === 'processing') {
    return { sessionId: id, status: 'already-processing' }
  }

  await updateSession(id, { status: 'processing' })

  const batchProvider = await getBatchProviderName()
  const useBatch = batchProvider !== null

  try {
    if (useBatch) {
      await eventStart(id, 'batch-create')
      const batchDbId = await createBatchFromSession(id)
      const externalId = await submitBatch(batchDbId)
      await eventStart(id, 'batch-submit', { batchDbId, externalId })
      await enqueueJob(id, 'batch-poll', undefined, new Date(Date.now() + 30_000))
    } else {
      await enqueueJob(id, 'realtime-translate')
    }
  } catch (err) {
    await updateSession(id, { status: 'failed' })
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to enqueue translation: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return { sessionId: id, status: 'processing', mode: useBatch ? 'batch' : 'realtime' }
})
