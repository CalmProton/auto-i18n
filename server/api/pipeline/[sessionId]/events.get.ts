import { getSessionById } from '../../../repositories/sessions'
import { getEventsBySession } from '../../../repositories/events'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')!

  const session = await getSessionById(sessionId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const events = await getEventsBySession(sessionId)
  return { events }
})
