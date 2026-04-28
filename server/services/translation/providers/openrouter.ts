import OpenAI from 'openai'
import { getSetting } from '../../../utils/getSetting'
import { buildMarkdownPrompts, buildJsonPrompts } from '../prompts'
import { StaggeredRequestQueue } from '../queue'
import type { TranslationProvider, TranslateOptions } from '../types'

const queue = new StaggeredRequestQueue(8, 300)

function getClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/auto-i18n',
      'X-Title': 'auto-i18n',
    },
  })
}

export class OpenRouterProvider implements TranslationProvider {
  readonly name = 'openrouter'

  async translateMarkdown(content: string, opts: TranslateOptions): Promise<string> {
    return queue.enqueue(async () => {
      const apiKey = await getSetting('OPENROUTER_API_KEY')
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

      const model = opts.model ?? (await getSetting('OPENROUTER_MODEL')) ?? 'openai/gpt-4o-mini'
      const { systemPrompt, userPrompt } = await buildMarkdownPrompts(opts.sourceLocale, opts.targetLocale)

      const client = getClient(apiKey)
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: `${systemPrompt}\n\n${userPrompt}` },
          { role: 'user', content: `---\n${content}\n---` },
        ],
        temperature: 0.3,
      })

      const result = response.choices[0]?.message?.content ?? ''
      // Strip any wrapping markdown fences the model might add
      return result.replace(/^```(?:markdown)?\n?/i, '').replace(/\n?```$/i, '').trim()
    })
  }

  async translateJson(
    data: Record<string, unknown>,
    opts: TranslateOptions,
  ): Promise<Record<string, unknown>> {
    return queue.enqueue(async () => {
      const apiKey = await getSetting('OPENROUTER_API_KEY')
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

      const model = opts.model ?? (await getSetting('OPENROUTER_MODEL')) ?? 'openai/gpt-4o-mini'
      const { systemPrompt, userPrompt } = await buildJsonPrompts(opts.sourceLocale, opts.targetLocale)

      const client = getClient(apiKey)
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: `${systemPrompt}\n\n${userPrompt}` },
          { role: 'user', content: `Input JSON:\n${JSON.stringify(data, null, 2)}` },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      })

      const raw = response.choices[0]?.message?.content ?? '{}'
      const parsed = JSON.parse(raw)
      // Unwrap the translation key
      const result = parsed.translation ?? parsed
      if (typeof result !== 'object' || result === null) {
        throw new Error('OpenRouter returned invalid JSON translation')
      }
      return result as Record<string, unknown>
    })
  }
}
