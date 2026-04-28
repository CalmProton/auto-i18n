import OpenAI from 'openai'
import { getSetting } from '../../../utils/getSetting'
import { buildMarkdownPrompts, buildJsonPrompts } from '../prompts'
import type { BatchRequest, BatchResult } from '../types'

function getClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey })
}

/**
 * Create a batch JSONL string from an array of BatchRequest items.
 */
export async function createOpenAIBatchJsonl(requests: BatchRequest[]): Promise<string> {
  const lines: string[] = []

  for (const req of requests) {
    const prompts = req.contentType === 'markdown'
      ? await buildMarkdownPrompts(req.sourceLocale, req.targetLocale)
      : await buildJsonPrompts(req.sourceLocale, req.targetLocale)

    const userContent = req.contentType === 'markdown'
      ? `---\n${req.content}\n---`
      : `Input JSON:\n${req.content}`

    const batchRequest = {
      custom_id: req.customId,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: await getSetting('OPENAI_BATCH_MODEL') ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `${prompts.systemPrompt}\n\n${prompts.userPrompt}` },
          { role: 'user', content: userContent },
        ],
        temperature: req.contentType === 'markdown' ? 0.3 : 0.1,
        ...(req.contentType === 'json' ? { response_format: { type: 'json_object' } } : {}),
      },
    }
    lines.push(JSON.stringify(batchRequest))
  }

  return lines.join('\n')
}

/**
 * Upload a JSONL string as a file to OpenAI and submit it as a batch.
 * Returns the OpenAI batch ID.
 */
export async function submitOpenAIBatch(jsonl: string): Promise<string> {
  const apiKey = await getSetting('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const client = getClient(apiKey)

  // Upload the JSONL as a file
  const blob = new Blob([jsonl], { type: 'application/json' })
  const file = new File([blob], 'batch.jsonl', { type: 'application/json' })
  const uploadedFile = await client.files.create({ file, purpose: 'batch' })

  // Create the batch
  const batch = await client.batches.create({
    input_file_id: uploadedFile.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
  })

  return batch.id
}

/**
 * Poll the status of an OpenAI batch.
 */
export async function pollOpenAIBatch(
  batchId: string,
): Promise<{ status: string; completed: number; failed: number; total: number }> {
  const apiKey = await getSetting('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const client = getClient(apiKey)

  const batch = await client.batches.retrieve(batchId)
  return {
    status: batch.status,
    completed: batch.request_counts?.completed ?? 0,
    failed: batch.request_counts?.failed ?? 0,
    total: batch.request_counts?.total ?? 0,
  }
}

/**
 * Download and parse the output of a completed OpenAI batch.
 * Returns an array of BatchResult items.
 */
export async function processOpenAIBatchOutput(batchId: string): Promise<BatchResult[]> {
  const apiKey = await getSetting('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const client = getClient(apiKey)

  const batch = await client.batches.retrieve(batchId)
  if (!batch.output_file_id) {
    throw new Error(`Batch ${batchId} has no output file`)
  }

  const fileContent = await client.files.content(batch.output_file_id)
  const text = await fileContent.text()

  const results: BatchResult[] = []
  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      const customId: string = row.custom_id
      const choice = row.response?.body?.choices?.[0]?.message?.content
      if (row.error) {
        results.push({ customId, content: null, error: row.error.message ?? 'Unknown error' })
      } else if (choice != null) {
        results.push({ customId, content: choice, error: null })
      } else {
        results.push({ customId, content: null, error: 'No content in response' })
      }
    } catch {
      // skip malformed lines
    }
  }
  return results
}
