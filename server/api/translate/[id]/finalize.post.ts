import { getSessionById } from '../../../repositories/sessions'
import { enqueueJob } from '../../../queue'

/**
 * POST /api/translate/:id/finalize
 * Trigger git forge output for a changes session.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await getSessionById(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  if (session.sessionType !== 'changes') {
    throw createError({ statusCode: 400, statusMessage: 'Only changes sessions can be finalized via this endpoint' })
  }

  if (session.status !== 'completed') {
    throw createError({ statusCode: 400, statusMessage: `Session must be in 'completed' state before finalizing (current: ${session.status})` })
  }

  const jobId = await enqueueJob(id, 'git-finalize')

  return { sessionId: id, jobId, status: 'git-finalize-enqueued' }
})
