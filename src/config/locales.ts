export type SupportedLocale = {
  code: string
  iso: string
  name: string
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  { code: 'en', iso: 'en-US', name: 'English' },
  { code: 'ru', iso: 'ru-RU', name: 'Russian' },
  { code: 'zh', iso: 'zh-CN', name: 'Chinese' },
  // { code: 'hi', iso: 'hi-IN', name: 'Hindi' },
  // { code: 'es', iso: 'es-ES', name: 'Spanish' },
  // { code: 'fr', iso: 'fr-FR', name: 'French' },
  // { code: 'ar', iso: 'ar-SA', name: 'Arabic' },
  // { code: 'bn', iso: 'bn-BD', name: 'Bengali' },
  // { code: 'pt', iso: 'pt-PT', name: 'Portuguese' },
  // { code: 'id', iso: 'id-ID', name: 'Indonesian' },
  // { code: 'de', iso: 'de-DE', name: 'German' },
  // { code: 'ja', iso: 'ja-JP', name: 'Japanese' },
  // { code: 'ko', iso: 'ko-KR', name: 'Korean' },
  // { code: 'tr', iso: 'tr-TR', name: 'Turkish' },
  // { code: 'vi', iso: 'vi-VN', name: 'Vietnamese' },
  // { code: 'it', iso: 'it-IT', name: 'Italian' },
  // { code: 'fa', iso: 'fa-IR', name: 'Persian' },
  // { code: 'pl', iso: 'pl-PL', name: 'Polish' },
  // { code: 'nl', iso: 'nl-NL', name: 'Dutch' },
  // { code: 'ro', iso: 'ro-RO', name: 'Romanian' },
  // { code: 'el', iso: 'el-GR', name: 'Greek' },
  // { code: 'cs', iso: 'cs-CZ', name: 'Czech' },
  // { code: 'hu', iso: 'hu-HU', name: 'Hungarian' },
  // { code: 'sv', iso: 'sv-SE', name: 'Swedish' },
  // { code: 'bg', iso: 'bg-BG', name: 'Bulgarian' },
  // { code: 'da', iso: 'da-DK', name: 'Danish' },
  // { code: 'fi', iso: 'fi-FI', name: 'Finnish' },
  // { code: 'sk', iso: 'sk-SK', name: 'Slovak' },
  // { code: 'hr', iso: 'hr-HR', name: 'Croatian' },
  // { code: 'no', iso: 'no-NO', name: 'Norwegian' },
  // { code: 'sl', iso: 'sl-SI', name: 'Slovenian' },
  // { code: 'sr', iso: 'sr-RS', name: 'Serbian' }
]

const SUPPORTED_CODES = new Set(SUPPORTED_LOCALES.map((locale) => locale.code))

export function isSupportedLocale(code: string | null | undefined): code is string {
  if (!code) {
    return false
  }
  return SUPPORTED_CODES.has(code)
}
