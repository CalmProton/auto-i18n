import { setSetting, isMasked } from '../utils/getSetting'
import { invalidateProviderCache } from '../services/translation'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, string>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a key-value object' })
  }

  const PROVIDER_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_MODEL', 'OPENAI_BATCH_MODEL', 'ANTHROPIC_BATCH_MODEL', 'MOCK_MODE', 'BATCH_PROVIDER']

  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue
    // If the value is masked (user sent it back unchanged), skip to avoid overwriting
    if (isMasked(value)) continue
    await setSetting(key, value)
  }

  // Bust provider cache if provider-related keys changed
  const providerKeyChanged = Object.keys(body).some(k => PROVIDER_KEYS.includes(k))
  if (providerKeyChanged) invalidateProviderCache()

  return { ok: true }
})
