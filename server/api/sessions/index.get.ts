import { listSessions, countSessions } from '../../repositories/sessions'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  const [sessions, total] = await Promise.all([
    listSessions(limit, offset),
    countSessions(),
  ])

  return { sessions, total, limit, offset }
})
