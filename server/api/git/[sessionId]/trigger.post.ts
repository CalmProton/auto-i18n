import { getSessionById } from '../../../repositories/sessions'
import { enqueueJob } from '../../../queue'
import { db, schema } from '../../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  // Check there are translated files before attempting git
  const files = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.sessionId, sessionId))
  const hasTranslations = files.some(f => f.fileType === 'translation')
  if (!hasTranslations) {
    throw createError({ statusCode: 422, statusMessage: 'No translated files found — run translation first' })
  }

  const jobId = await enqueueJob(sessionId, 'git-finalize')
  return { ok: true, jobId }
})
