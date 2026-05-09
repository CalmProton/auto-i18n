import { getSessionsByStatus } from '../../repositories/sessions'
import { db, schema } from '../../db'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/git/ready
 * List sessions that are completed but don't have git jobs yet.
 */
export default defineEventHandler(async () => {
  const completed = await getSessionsByStatus('completed')

  const ready = []
  for (const s of completed) {
    const [existing] = await db
      .select()
      .from(schema.gitJobs)
      .where(eq(schema.gitJobs.sessionId, s.id))
    if (!existing) {
      ready.push({
        id: s.id,
        senderId: s.senderId,
        sourceLocale: s.sourceLocale,
        targetLocales: s.targetLocales,
        createdAt: s.createdAt,
      })
    }
  }

  return { ready, count: ready.length }
})
