import { getSetting } from '../../utils/getSetting'
import { OpenRouterProvider } from './providers/openrouter'
import { MockProvider } from './providers/mock'
import type { TranslationProvider } from './types'

let _realtimeProvider: TranslationProvider | null = null

/**
 * Get the configured real-time translation provider.
 * Returns MockProvider if MOCK_MODE=true or no API key is configured.
 */
export async function getRealtimeProvider(): Promise<TranslationProvider> {
  const mockMode = (await getSetting('MOCK_MODE')) === 'true'
  if (mockMode) return new MockProvider()

  const apiKey = await getSetting('OPENROUTER_API_KEY')
  if (!apiKey) {
    console.warn('[translation] OPENROUTER_API_KEY not configured — using mock provider')
    return new MockProvider()
  }

  if (!_realtimeProvider) {
    _realtimeProvider = new OpenRouterProvider()
  }
  return _realtimeProvider
}

/** Invalidate provider cache (called after settings update) */
export function invalidateProviderCache(): void {
  _realtimeProvider = null
}

/**
 * Get the configured batch provider name.
 * Returns 'openai' | 'anthropic' | null if neither is configured.
 */
export async function getBatchProviderName(): Promise<'openai' | 'anthropic' | null> {
  const configured = (await getSetting('BATCH_PROVIDER')) ?? 'auto'

  if (configured === 'openai') {
    const key = await getSetting('OPENAI_API_KEY')
    return key ? 'openai' : null
  }
  if (configured === 'anthropic') {
    const key = await getSetting('ANTHROPIC_API_KEY')
    return key ? 'anthropic' : null
  }

  // auto: pick whichever has a key, prefer openai
  const [openaiKey, anthropicKey] = await Promise.all([
    getSetting('OPENAI_API_KEY'),
    getSetting('ANTHROPIC_API_KEY'),
  ])
  if (openaiKey) return 'openai'
  if (anthropicKey) return 'anthropic'
  return null
}
