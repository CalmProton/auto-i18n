import { getSessionById } from '../../../repositories/sessions'
import { getBatchBySession } from '../../../repositories/batches'
import { submitBatch } from '../../../services/translation/batchService'
import { enqueueJob } from '../../../queue'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const batch = await getBatchBySession(sessionId)
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'No batch found for session' })

  if (batch.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: `Batch is already in status: ${batch.status}` })
  }

  const externalId = await submitBatch(batch.id)
  await enqueueJob(sessionId, 'batch-poll', undefined, new Date(Date.now() + 30_000))

  return { ok: true, externalId }
})
