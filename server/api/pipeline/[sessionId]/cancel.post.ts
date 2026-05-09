import { db, schema } from '../../../db'
import { eq, and } from 'drizzle-orm'
import { getSessionById } from '../../../repositories/sessions'

/**
 * POST /api/pipeline/:sessionId/cancel
 * Cancel all pending jobs for a session.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  // Cancel all pending jobs
  const result = await db
    .update(schema.jobs)
    .set({ status: 'failed', error: 'Cancelled by user' })
    .where(and(
      eq(schema.jobs.sessionId, sessionId),
      eq(schema.jobs.status, 'pending'),
    ))

  return { sessionId, cancelled: true }
})
