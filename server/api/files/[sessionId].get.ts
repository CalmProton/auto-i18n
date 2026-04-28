import { getSessionById } from '../../repositories/sessions'
import { getFilesBySession } from '../../repositories/files'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!
  const query = getQuery(event)

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  let files = await getFilesBySession(sessionId)

  // Optional filters
  if (query.fileType) files = files.filter(f => f.fileType === query.fileType)
  if (query.locale) files = files.filter(f => f.locale === query.locale)

  // Don't return content in list view — use individual file endpoint for content
  const fileList = files.map(({ content: _c, ...f }) => f)

  return { files: fileList, total: fileList.length }
})
