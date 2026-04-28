import { getSessionById, deleteSession } from '../../repositories/sessions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await getSessionById(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  await deleteSession(id)
  return { ok: true }
})
