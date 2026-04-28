/**
 * Locale utilities for auto-i18n v2.
 *
 * v1 had a hardcoded 32-locale allowlist. v2 accepts any valid locale code
 * and uses Intl.DisplayNames for human-readable names in prompts.
 */

/**
 * Validates and normalises a locale code.
 * Accepts: en, fr, pt-BR, zh-TW, zh-Hant, az-Latn-AZ, etc.
 * Normalises: lowercases language, uppercases region, title-cases script.
 * Returns undefined if the format is invalid.
 */
export function normaliseLocale(input: string): string | undefined {
  if (!input || typeof input !== 'string') return undefined
  const trimmed = input.trim()

  // BCP-47 subtag pattern: language[-script][-region]
  // language: 2-3 letters; script: 4 letters; region: 2 letters or 3 digits
  const match = trimmed.match(
    /^([a-zA-Z]{2,3})(?:-([a-zA-Z]{4}))?(?:-([a-zA-Z]{2}|\d{3}))?$/
  )
  if (!match) return undefined

  const lang = match[1]!.toLowerCase()
  const script = match[2] ? match[2][0]!.toUpperCase() + match[2].slice(1).toLowerCase() : undefined
  const region = match[3] ? match[3].toUpperCase() : undefined

  return [lang, script, region].filter(Boolean).join('-')
}

/**
 * Returns the English display name for a locale code.
 * Uses Intl.DisplayNames; falls back to the code itself.
 */
export function getLocaleName(locale: string): string {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' })
    const name = dn.of(locale)
    if (name && name !== locale) return name
  } catch {
    // Intl not available or unrecognised locale
  }
  return locale
}

/**
 * Validates a locale code and throws a 400 error if invalid.
 * Returns the normalised code.
 */
export function requireValidLocale(input: string): string {
  const normalised = normaliseLocale(input)
  if (!normalised) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid locale code: "${input}". Expected format: en, fr, pt-BR, zh-TW, etc.`,
    })
  }
  return normalised
}

/**
 * Parse and validate an array of locale codes.
 */
export function parseLocaleArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'targetLocales must be a JSON array' })
  }
  return input.map((l) => requireValidLocale(String(l)))
}
