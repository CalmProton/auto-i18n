import { isAuthEnabled } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const enabled = await isAuthEnabled()
  const provided =
    getHeader(event, 'x-access-key') ??
    getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')

  if (!enabled) return { enabled: false, authenticated: true }

  const { validateRequest } = await import('../../utils/auth')
  const authenticated = await validateRequest(event)
  return { enabled: true, authenticated }
})
