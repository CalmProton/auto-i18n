import { validateRequest, isAuthEnabled } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const path = event.node.req.url ?? ''

  // Auth, SSE keep-alive, and public health check are always open
  if (
    path.startsWith('/api/auth/') ||
    path === '/' ||
    path.startsWith('/_nuxt') ||
    path.startsWith('/__nuxt') ||
    !path.startsWith('/api/')
  ) {
    return
  }

  // If auth is not enabled, allow everything
  const authEnabled = await isAuthEnabled()
  if (!authEnabled) return

  const valid = await validateRequest(event)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
