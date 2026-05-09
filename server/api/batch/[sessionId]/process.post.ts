import { getSessionById } from '../../../repositories/sessions'
import { getBatchBySession } from '../../../repositories/batches'
import { processBatchOutput } from '../../../services/translation/batchService'

/**
 * POST /api/batch/:sessionId/process
 * Dashboard-triggered batch processing for a completed external batch.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const batch = await getBatchBySession(sessionId)
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'No batch found for session' })

  if (!batch.externalBatchId) {
    throw createError({ statusCode: 400, statusMessage: 'Batch has not been submitted yet' })
  }

  await processBatchOutput(batch.id)

  return { batchId: batch.id, sessionId, status: 'completed' }
})
