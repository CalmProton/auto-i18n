import { getSessionById } from '../../../repositories/sessions'
import { db, schema } from '../../../db'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!
  const fileId = getRouterParam(event, 'fileId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const [file] = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.sessionId, sessionId)))

  if (!file) throw createError({ statusCode: 404, statusMessage: 'File not found' })

  return { file }
})
