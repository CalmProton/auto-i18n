import { isAuthEnabled, getAccessKey } from '../../utils/auth'

/**
 * POST /api/auth/validate
 * Validate an access key token.
 * Body: { accessKey?: string }
 * Returns { valid: true } if auth is disabled or the key matches.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ accessKey?: string }>(event)

  const enabled = await isAuthEnabled()
  if (!enabled) {
    return { enabled: false, valid: true }
  }

  const configuredKey = await getAccessKey()
  const providedKey = body?.accessKey?.trim()

  const valid = !!(providedKey && providedKey === configuredKey)

  return { enabled: true, valid }
})
