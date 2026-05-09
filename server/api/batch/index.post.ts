import { getSessionById } from '../../repositories/sessions'
import { getBatchBySession } from '../../repositories/batches'
import { createBatchFromSession, submitBatch } from '../../services/translation/batchService'
import { enqueueJob } from '../../queue'
import { eventStart } from '../../repositories/events'

/**
 * POST /api/batch
 * Create a batch manifest from an existing session's uploaded files.
 * Body: { sessionId: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: string }>(event)

  if (!body?.sessionId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'sessionId is required' })
  }

  const sessionId = body.sessionId.trim()
  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  // Don't duplicate batches
  const existing = await getBatchBySession(sessionId)
  if (existing) {
    return { batchId: existing.id, sessionId, status: existing.status, created: false }
  }

  await eventStart(sessionId, 'batch-create')
  const batchDbId = await createBatchFromSession(sessionId)

  // Optionally auto-submit
  if (body.submit !== false) {
    const externalId = await submitBatch(batchDbId)
    await eventStart(sessionId, 'batch-submit', { batchDbId, externalId })
    await enqueueJob(sessionId, 'batch-poll', undefined, new Date(Date.now() + 30_000))
    return { batchId: batchDbId, sessionId, status: 'submitted', externalId, created: true }
  }

  return { batchId: batchDbId, sessionId, status: 'pending', created: true }
})
