/**
 * OpenRouter provider — real-time translation via the @openrouter/agent SDK.
 *
 * Features:
 * - Any model available on OpenRouter through a single OPENROUTER_API_KEY
 * - Configurable temperature per content type (markdown vs JSON)
 * - Prompt compression via ContextCompressionPlugin
 * - Provider preference routing (OPENROUTER_PROVIDER_ORDER)
 * - Multi-model fallback routing (OPENROUTER_FALLBACK_MODEL)
 * - Automatic retry on rate limits and server errors with exponential backoff
 * - Structured JSON output via text.format
 */
import { OpenRouter } from '@openrouter/agent'
import { getSetting } from '../../../utils/getSetting'
import { buildMarkdownPrompts, buildJsonPrompts } from '../prompts'
import { StaggeredRequestQueue } from '../queue'
import type { TranslationProvider, TranslateOptions } from '../types'

const queue = new StaggeredRequestQueue(8, 300)

function getClient(apiKey: string): OpenRouter {
  return new OpenRouter({
    apiKey,
    appUrl: 'https://github.com/CalmProton/auto-i18n',
    appTitle: 'auto-i18n',
  })
}

export class OpenRouterProvider implements TranslationProvider {
  readonly name = 'openrouter'

  async translateMarkdown(content: string, opts: TranslateOptions): Promise<string> {
    return queue.enqueue(async () => {
      const { client, model, extra } = await this.resolveConfig(opts)
      const { systemPrompt, userPrompt } = await buildMarkdownPrompts(opts.sourceLocale, opts.targetLocale)
      const temperature = parseFloat((await getSetting('TRANSLATE_TEMPERATURE_MARKDOWN')) ?? '0.3')

      return this.callWithRetry(async () => {
        const result = client.callModel({
          model,
          input: `---\n${content}\n---`,
          instructions: `${systemPrompt}\n\n${userPrompt}`,
          temperature,
          ...extra,
        } as any)
        return result
      }, 3).then(async (result) => {
        const text = await result.getText()
        return text.replace(/^```(?:markdown)?\n?/i, '').replace(/\n?```$/i, '').trim()
      })
    })
  }

  async translateJson(
    data: Record<string, unknown>,
    opts: TranslateOptions,
  ): Promise<Record<string, unknown>> {
    return queue.enqueue(async () => {
      const { client, model, extra } = await this.resolveConfig(opts)
      const { systemPrompt, userPrompt } = await buildJsonPrompts(opts.sourceLocale, opts.targetLocale)
      const temperature = parseFloat((await getSetting('TRANSLATE_TEMPERATURE_JSON')) ?? '0.1')

      return this.callWithRetry(async () => {
        const result = client.callModel({
          model,
          input: `Input JSON:\n${JSON.stringify(data, null, 2)}`,
          instructions: `${systemPrompt}\n\n${userPrompt}`,
          temperature,
          text: { format: { type: 'json_object' } },
          ...extra,
        } as any)
        return result
      }, 3).then(async (result) => {
        const raw = await result.getText()
        const parsed = JSON.parse(raw)
        const translated = parsed.translation ?? parsed
        if (typeof translated !== 'object' || translated === null) {
          throw new Error('OpenRouter returned invalid JSON translation')
        }
        return translated as Record<string, unknown>
      })
    })
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async resolveConfig(opts: TranslateOptions): Promise<{
    client: OpenRouter
    model: string
    extra: Record<string, unknown>
  }> {
    const apiKey = await getSetting('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    const model = opts.model ?? (await getSetting('OPENROUTER_MODEL')) ?? 'openai/gpt-4o-mini'
    const client = getClient(apiKey)
    const extra: Record<string, unknown> = {}

    // Session ID for telemetry grouping
    if (opts.sessionId) {
      extra.sessionId = `auto-i18n-${opts.sessionId.slice(0, 8)}`
    }

    // Context compression plugin (replaces legacy `transforms` parameter)
    const transformsRaw = await getSetting('OPENROUTER_TRANSFORMS')
    if (transformsRaw && transformsRaw !== 'none') {
      const transforms = transformsRaw.split(',').map(t => t.trim()).filter(Boolean)
      if (transforms.length > 0) {
        extra.plugins = [{
          id: 'openrouter/context-compression',
          settings: { mode: 'auto', strategy: transforms[0] },
        }]
      }
    }

    // Provider preference routing
    const providerOrderRaw = await getSetting('OPENROUTER_PROVIDER_ORDER')
    if (providerOrderRaw) {
      const order = providerOrderRaw.split(',').map(p => p.trim()).filter(Boolean)
      if (order.length > 0) {
        extra.provider = {
          order,
          allow_fallbacks: true,
          require_parameters: true,
        }
      }
    }

    // Multi-model fallback routing
    const fallbackModelsRaw = await getSetting('OPENROUTER_FALLBACK_MODELS')
    if (fallbackModelsRaw) {
      const fallbacks = fallbackModelsRaw.split(',').map(m => m.trim()).filter(Boolean)
      if (fallbacks.length > 0) {
        // models[] is OpenRouter's multi-model fallback; the first one that succeeds wins
        extra.models = [model, ...fallbacks]
      }
    }

    return { client, model, extra }
  }

  /**
   * Call an API function with retry logic for rate limits (429) and server errors (5xx).
   * Uses exponential backoff: 1s, 2s, 4s.
   */
  private async callWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // Check for retryable status codes from the SDK error
        const status = err?.status ?? err?.statusCode ?? err?.response?.status

        if (status === 429 || (typeof status === 'number' && status >= 500)) {
          const delay = Math.pow(2, attempt) * 1000
          console.warn(
            `[openrouter] attempt ${attempt + 1}/${maxRetries} after ${status} → retrying in ${delay}ms`,
          )
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        throw lastError
      }
    }

    throw lastError ?? new Error('Max retries exceeded')
  }
}
