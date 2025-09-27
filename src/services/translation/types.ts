import type { TranslationProvider } from '../../config/env'

export type TranslationJobMetadata = {
  senderId: string
  sourceLocale: string
  targetLocale: string
  filePath: string
}

export type MarkdownTranslationInput = TranslationJobMetadata & {
  content: string
}

export type JsonTranslationInput = TranslationJobMetadata & {
  data: unknown
}

export interface TranslationProviderAdapter {
  name: TranslationProvider
  readonly isFallback?: boolean
  translateMarkdown(job: MarkdownTranslationInput): Promise<string>
  translateJson(job: JsonTranslationInput): Promise<unknown>
}
