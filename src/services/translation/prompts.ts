import { SUPPORTED_LOCALES } from '../../config/locales'

function localeDisplayName(code: string): string {
  return SUPPORTED_LOCALES.find((item) => item.code === code)?.name ?? code
}

export const TRANSLATION_SYSTEM_PROMPT = 'You are a professional localization specialist.'

export function buildMarkdownTranslationPrompt(sourceLocale: string, targetLocale: string): string {
  return (
    `Translate the following Markdown content from ${localeDisplayName(sourceLocale)} (${sourceLocale}) ` +
    `to ${localeDisplayName(targetLocale)} (${targetLocale}). ` +
    'Preserve the original Markdown structure, code fences, front matter, and placeholders. ' +
    'Only return the translated Markdown without commentary.'
  )
}

export function buildJsonTranslationPrompt(sourceLocale: string, targetLocale: string): string {
  return (
    `Translate the JSON values from ${localeDisplayName(sourceLocale)} (${sourceLocale}) ` +
    `to ${localeDisplayName(targetLocale)} (${targetLocale}). ` +
    'Do not change the keys or structure. Only return valid JSON with translated string values. ' +
    'Leave non-string values untouched.'
  )
}

export const JSON_TRANSLATION_WRAPPER_DIRECTIVE =
  'Please return the translated JSON wrapped in an object with a "translation" key like this: {"translation": <your_translated_json>}'

export const MARKDOWN_RESPONSE_DIRECTIVE = 'Return only the translated Markdown.'
export const JSON_RESPONSE_DIRECTIVE = 'Return only the translated JSON.'

export { localeDisplayName }
