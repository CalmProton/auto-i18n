import type { ZodTypeAny } from 'zod'
import { createScopedLogger } from '../../utils/logger'
import type { MarkdownTranslationInput, JsonTranslationInput } from './types'

export interface MarkdownRequestContext {
  type: 'markdown'
  job: MarkdownTranslationInput
  instruction: string
  content: string
}

export interface JsonRequestContext {
  type: 'json'
  job: JsonTranslationInput
  instruction: string
  data: unknown
  schema: ZodTypeAny | null
}

export type TranslationRequestContext = MarkdownRequestContext | JsonRequestContext

export const baseLogger = createScopedLogger('translation:provider')

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  if (value === undefined || value === null) {
    return value
  }
  const json = JSON.stringify(value)
  if (!json) {
    return value
  }
  return JSON.parse(json)
}

export function stringifyJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function parseJsonResponse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Provider returned invalid JSON: ${(error as Error).message}`)
  }
}

export function jsonType(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

export function previewText(value: string, maxLength = 200): string {
  if (value.length <= maxLength) {
    return value
  }
  const sliced = value.slice(0, maxLength)
  const omitted = value.length - maxLength
  return `${sliced}… [+${omitted} chars]`
}
