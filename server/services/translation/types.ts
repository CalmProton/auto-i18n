export interface TranslateOptions {
  sourceLocale: string
  targetLocale: string
  sessionId: string
  /** Used for OpenRouter — model string e.g. 'openai/gpt-4o-mini' */
  model?: string
}

export interface TranslationProvider {
  readonly name: string
  translateMarkdown(content: string, opts: TranslateOptions): Promise<string>
  translateJson(data: Record<string, unknown>, opts: TranslateOptions): Promise<Record<string, unknown>>
}

export interface BatchJobOptions {
  sessionId: string
  model?: string
}

export interface BatchRequest {
  customId: string
  content: string
  contentType: 'markdown' | 'json'
  sourceLocale: string
  targetLocale: string
  filePath: string
}

export interface BatchResult {
  customId: string
  content: string | null
  error: string | null
}
