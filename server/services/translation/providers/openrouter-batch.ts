/**
 * OpenRouter "batch" provider — parallel real-time translation through OpenRouter.
 *
 * OpenRouter doesn't have a native batch API. This provider achieves batch-like
 * throughput by queuing all requests through the StaggeredRequestQueue inside
 * OpenRouterProvider, which limits concurrency and staggers calls to avoid rate limits.
 *
 * Set BATCH_PROVIDER=openrouter to prefer OpenRouter for batch operations,
 * or use auto (default) which picks OpenRouter when no native OpenAI/Anthropic keys exist.
 */
import { OpenRouterProvider } from './openrouter'
import { getSetting } from '../../../utils/getSetting'
import type { BatchRequest, BatchResult } from '../types'

/**
 * Process an array of batch requests through OpenRouter's real-time endpoint.
 * All requests are dispatched concurrently; the provider's StaggeredRequestQueue
 * handles concurrency control internally.
 */
export async function processOpenRouterBatch(requests: BatchRequest[]): Promise<BatchResult[]> {
  const provider = new OpenRouterProvider()
  const results: BatchResult[] = []

  const promises = requests.map(async (req) => {
    try {
      let content: string
      if (req.contentType === 'markdown') {
        content = await provider.translateMarkdown(req.content, {
          sourceLocale: req.sourceLocale,
          targetLocale: req.targetLocale,
          sessionId: req.filePath, // for telemetry grouping
        })
      } else {
        const parsed = JSON.parse(req.content)
        const result = await provider.translateJson(parsed, {
          sourceLocale: req.sourceLocale,
          targetLocale: req.targetLocale,
          sessionId: req.filePath,
        })
        content = JSON.stringify(result, null, 2)
      }
      results.push({ customId: req.customId, content, error: null })
    } catch (err) {
      results.push({
        customId: req.customId,
        content: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  await Promise.allSettled(promises)

  // Sort to match input order
  const orderMap = new Map(requests.map((r, i) => [r.customId, i]))
  results.sort((a, b) => (orderMap.get(a.customId) ?? 0) - (orderMap.get(b.customId) ?? 0))

  return results
}

/** Check if OpenRouter batch mode is available */
export async function isOpenRouterBatchAvailable(): Promise<boolean> {
  const key = await getSetting('OPENROUTER_API_KEY')
  return !!(key && key.trim().length > 0)
}
