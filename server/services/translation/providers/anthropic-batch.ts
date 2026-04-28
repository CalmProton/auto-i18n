import Anthropic from '@anthropic-ai/sdk'
import { getSetting } from '../../../utils/getSetting'
import { buildMarkdownPrompts, buildJsonPrompts } from '../prompts'
import type { BatchRequest, BatchResult } from '../types'

function getClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

/**
 * Submit an array of BatchRequests to Anthropic's Message Batches API.
 * Returns the Anthropic batch ID.
 */
export async function submitAnthropicBatch(requests: BatchRequest[]): Promise<string> {
  const apiKey = await getSetting('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const model = (await getSetting('ANTHROPIC_BATCH_MODEL')) ?? 'claude-3-haiku-20240307'
  const client = getClient(apiKey)

  const batchRequests = await Promise.all(
    requests.map(async (req) => {
      const prompts = req.contentType === 'markdown'
        ? await buildMarkdownPrompts(req.sourceLocale, req.targetLocale)
        : await buildJsonPrompts(req.sourceLocale, req.targetLocale)

      const userContent = req.contentType === 'markdown'
        ? `---\n${req.content}\n---`
        : `Input JSON:\n${req.content}`

      return {
        custom_id: req.customId,
        params: {
          model,
          max_tokens: 8192,
          system: `${prompts.systemPrompt}\n\n${prompts.userPrompt}`,
          messages: [{ role: 'user' as const, content: userContent }],
        },
      }
    }),
  )

  const batch = await client.messages.batches.create({ requests: batchRequests })
  return batch.id
}

/**
 * Poll the status of an Anthropic batch.
 */
export async function pollAnthropicBatch(
  batchId: string,
): Promise<{ status: string; completed: number; failed: number; total: number }> {
  const apiKey = await getSetting('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const client = getClient(apiKey)

  const batch = await client.messages.batches.retrieve(batchId)
  const counts = batch.request_counts
  // Anthropic statuses: 'in_progress' | 'ended'
  const status = batch.processing_status === 'ended' ? 'completed' : 'in_progress'
  return {
    status,
    completed: counts.succeeded,
    failed: counts.errored + counts.canceled,
    total: counts.processing + counts.succeeded + counts.errored + counts.canceled + counts.expired,
  }
}

/**
 * Download and parse the output of a completed Anthropic batch.
 */
export async function processAnthropicBatchOutput(batchId: string): Promise<BatchResult[]> {
  const apiKey = await getSetting('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const client = getClient(apiKey)

  const results: BatchResult[] = []
  for await (const result of await client.messages.batches.results(batchId)) {
    if (result.result.type === 'succeeded') {
      const content = result.result.message.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
      results.push({ customId: result.custom_id, content, error: null })
    } else {
      const errType = result.result.type
      results.push({
        customId: result.custom_id,
        content: null,
        error: errType === 'errored' ? (result.result as any).error?.message ?? 'Error' : errType,
      })
    }
  }
  return results
}
