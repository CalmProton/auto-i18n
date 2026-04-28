import { getSessionById } from '../../../repositories/sessions'
import { getLogsBySession } from '../../../repositories/logs'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const logs = await getLogsBySession(sessionId)
  return { logs }
})
