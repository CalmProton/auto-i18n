import { getSessionById } from '../../../repositories/sessions'
import { getFilesByType } from '../../../repositories/files'

/**
 * GET /api/sessions/:id/output
 * Download all translated files for a session as JSON.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await getSessionById(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const translations = await getFilesByType(id, 'translation')

  const targetLocales: string[] = JSON.parse(session.targetLocales)

  const files = translations.map(f => ({
    type: f.contentType,
    locale: f.locale,
    path: f.filePath,
    content: f.content,
  }))

  return {
    sessionId: id,
    senderId: session.senderId,
    sourceLocale: session.sourceLocale,
    targetLocales,
    status: session.status,
    files,
    count: files.length,
  }
})
