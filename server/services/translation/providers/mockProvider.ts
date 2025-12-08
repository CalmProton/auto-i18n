/**
 * Mock Translation Provider
 *
 * Returns placeholder translations without making any API calls.
 * Useful for testing the UI and workflow without incurring costs.
 *
 * Output format:
 * - JSON: "{translated <sourceLocale>.<key.path> to <targetLocale>}"
 * - Markdown: Content wrapped with translation marker
 */
import type { TranslationProviderAdapter, MarkdownTranslationInput, JsonTranslationInput } from '../types'
import { baseLogger } from '../providerShared'
import type { Logger } from '../../../utils/logger'

export class MockProvider implements TranslationProviderAdapter {
  public readonly name = 'mock' as const
  public readonly isFallback = false

  private readonly log: Logger
  private readonly simulatedDelayMs: number

  constructor(options?: { simulatedDelayMs?: number }) {
    this.simulatedDelayMs = options?.simulatedDelayMs ?? 100
    this.log = baseLogger.child({ provider: this.name })

    this.log.info('Mock provider initialized', {
      simulatedDelayMs: this.simulatedDelayMs,
    })
  }

  async translateMarkdown(job: MarkdownTranslationInput): Promise<string> {
    this.log.info('Mock translating markdown', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      filePath: job.filePath,
      contentLength: job.content.length,
    })

    // Simulate processing time
    await this.delay()

    // Return mock translation with markers
    const mockTranslation = this.mockMarkdownContent(
      job.content,
      job.sourceLocale,
      job.targetLocale,
      job.filePath
    )

    this.log.debug('Mock markdown translation complete', {
      senderId: job.senderId,
      filePath: job.filePath,
      outputLength: mockTranslation.length,
    })

    return mockTranslation
  }

  async translateJson(job: JsonTranslationInput): Promise<unknown> {
    this.log.info('Mock translating JSON', {
      senderId: job.senderId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      filePath: job.filePath,
      dataType: typeof job.data,
    })

    // Simulate processing time
    await this.delay()

    // Return mock translation with placeholder strings
    const mockTranslation = this.mockJsonValue(
      job.data,
      job.sourceLocale,
      job.targetLocale,
      job.filePath,
      []
    )

    this.log.debug('Mock JSON translation complete', {
      senderId: job.senderId,
      filePath: job.filePath,
    })

    return mockTranslation
  }

  /**
   * Mock markdown content by wrapping translatable text
   */
  private mockMarkdownContent(
    content: string,
    sourceLocale: string,
    targetLocale: string,
    filePath: string
  ): string {
    // Extract filename without extension for context
    const fileName = filePath.split('/').pop()?.replace(/\.(md|mdx)$/i, '') || 'content'

    // Process line by line, preserving structure
    const lines = content.split('\n')
    const mockLines = lines.map((line, index) => {
      // Skip empty lines
      if (!line.trim()) {
        return line
      }

      // Preserve frontmatter delimiters
      if (line.trim() === '---') {
        return line
      }

      // Check if this is a frontmatter key: value line
      const frontmatterMatch = line.match(/^(\s*)([\w-]+):\s*(.+)$/)
      if (frontmatterMatch) {
        const [, indent, key, value] = frontmatterMatch
        // Only mock string values, not booleans/numbers
        if (value.startsWith('"') || value.startsWith("'") || /^[a-zA-Z]/.test(value)) {
          const cleanValue = value.replace(/^["']|["']$/g, '')
          return `${indent}${key}: "{translated ${sourceLocale}.${fileName}.${key} to ${targetLocale}}"`
        }
        return line
      }

      // Preserve code blocks
      if (line.trim().startsWith('```')) {
        return line
      }

      // Preserve import statements and JSX components
      if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) {
        return line
      }

      // For headings, preserve the heading markers
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        const [, hashes, text] = headingMatch
        return `${hashes} {translated ${sourceLocale}.${fileName}.heading_${index} to ${targetLocale}}`
      }

      // For regular text lines, mock the content
      if (line.trim().length > 0) {
        const indent = line.match(/^(\s*)/)?.[1] || ''
        return `${indent}{translated ${sourceLocale}.${fileName}.line_${index} to ${targetLocale}}`
      }

      return line
    })

    return mockLines.join('\n')
  }

  /**
   * Recursively mock JSON values
   */
  private mockJsonValue(
    value: unknown,
    sourceLocale: string,
    targetLocale: string,
    filePath: string,
    keyPath: string[]
  ): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return value
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.mockJsonValue(item, sourceLocale, targetLocale, filePath, [...keyPath, String(index)])
      )
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.mockJsonValue(val, sourceLocale, targetLocale, filePath, [...keyPath, key])
      }
      return result
    }

    // Handle strings - these are the translatable values
    if (typeof value === 'string') {
      const keyPathStr = keyPath.join('.')
      return `{translated ${sourceLocale}.${keyPathStr} to ${targetLocale}}`
    }

    // Pass through numbers, booleans, etc.
    return value
  }

  private delay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.simulatedDelayMs))
  }
}
