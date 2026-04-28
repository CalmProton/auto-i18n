import type { TranslationProvider, TranslateOptions } from '../types'

export class MockProvider implements TranslationProvider {
  readonly name = 'mock'

  async translateMarkdown(content: string, opts: TranslateOptions): Promise<string> {
    await sleep(50 + Math.random() * 100)
    // Return content with a mock prefix on the first heading or line
    const lines = content.split('\n')
    const firstNonEmpty = lines.findIndex(l => l.trim().length > 0)
    if (firstNonEmpty >= 0) {
      lines[firstNonEmpty] = `[MOCK:${opts.targetLocale}] ${lines[firstNonEmpty]}`
    }
    return lines.join('\n')
  }

  async translateJson(
    data: Record<string, unknown>,
    opts: TranslateOptions,
  ): Promise<Record<string, unknown>> {
    await sleep(30 + Math.random() * 70)
    return prefixValues(data, `[${opts.targetLocale}]`)
  }
}

function prefixValues(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = v.trim() ? `${prefix} ${v}` : v
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = prefixValues(v as Record<string, unknown>, prefix)
    } else {
      result[k] = v
    }
  }
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
