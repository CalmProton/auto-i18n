import { getSessionById } from '../../repositories/sessions'
import { getBatchBySession, getBatchRequestsByBatch } from '../../repositories/batches'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const batch = await getBatchBySession(sessionId)
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'No batch found for session' })

  const requests = await getBatchRequestsByBatch(batch.id)

  return {
    batch,
    requestCount: requests.length,
    pendingCount: requests.filter(r => r.status === 'pending').length,
    completedCount: requests.filter(r => r.status === 'completed').length,
    failedCount: requests.filter(r => r.status === 'failed').length,
  }
})
