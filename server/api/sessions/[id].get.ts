import { getSessionById } from '../../repositories/sessions'
import { getFilesBySession } from '../../repositories/files'
import { getBatchBySession } from '../../repositories/batches'
import { db, schema } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await getSessionById(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const [files, batch, gitJob] = await Promise.all([
    getFilesBySession(id),
    getBatchBySession(id),
    db.select().from(schema.gitJobs).where(eq(schema.gitJobs.sessionId, id)).then(r => r[0] ?? null),
  ])

  return {
    session,
    fileCount: files.length,
    translatedCount: files.filter(f => f.fileType === 'translation').length,
    batch: batch ?? null,
    gitJob: gitJob ?? null,
  }
})
