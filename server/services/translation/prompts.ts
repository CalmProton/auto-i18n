import { getSetting } from '../../utils/getSetting'
import { getLocaleName } from '../../utils/locales'

export interface BuiltPrompts {
  systemPrompt: string
  userPrompt: string
}

async function getPromptSetting(key: string, fallback: string): Promise<string> {
  const val = await getSetting(key)
  return val || fallback
}

/**
 * Build the markdown translation prompts for a given locale pair.
 * Loads from settings DB; substitutes {{SOURCE_LOCALE}} and {{TARGET_LOCALE}}.
 */
export async function buildMarkdownPrompts(
  sourceLocale: string,
  targetLocale: string,
): Promise<BuiltPrompts> {
  const sourceName = getLocaleName(sourceLocale)
  const targetName = getLocaleName(targetLocale)

  const [systemPrompt, userPromptTemplate] = await Promise.all([
    getPromptSetting('SYSTEM_PROMPT', ''),
    getPromptSetting('MARKDOWN_USER_PROMPT', ''),
  ])

  const userPrompt = userPromptTemplate
    .replace(/\{\{SOURCE_LOCALE\}\}/g, `${sourceName} (${sourceLocale})`)
    .replace(/\{\{TARGET_LOCALE\}\}/g, `${targetName} (${targetLocale})`)

  return { systemPrompt, userPrompt }
}

/**
 * Build the JSON translation prompts for a given locale pair.
 */
export async function buildJsonPrompts(
  sourceLocale: string,
  targetLocale: string,
): Promise<BuiltPrompts> {
  const sourceName = getLocaleName(sourceLocale)
  const targetName = getLocaleName(targetLocale)

  const [systemPrompt, userPromptTemplate] = await Promise.all([
    getPromptSetting('SYSTEM_PROMPT', ''),
    getPromptSetting('JSON_USER_PROMPT', ''),
  ])

  const userPrompt = userPromptTemplate
    .replace(/\{\{SOURCE_LOCALE\}\}/g, `${sourceName} (${sourceLocale})`)
    .replace(/\{\{TARGET_LOCALE\}\}/g, `${targetName} (${targetLocale})`)

  return { systemPrompt, userPrompt }
}
