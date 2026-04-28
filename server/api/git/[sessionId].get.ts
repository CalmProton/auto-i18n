import { getSessionById } from '../../repositories/sessions'
import { db, schema } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const [gitJob] = await db
    .select()
    .from(schema.gitJobs)
    .where(eq(schema.gitJobs.sessionId, sessionId))

  return { gitJob: gitJob ?? null, session }
})
