import { db, schema } from '../db'
import { eq } from 'drizzle-orm'

const { settings } = schema

/**
 * Read a setting value. Resolution order:
 *   1. settings DB table
 *   2. process.env[key]
 *   3. undefined
 */
export async function getSetting(key: string): Promise<string | undefined> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, key))
    if (row?.value !== undefined && row.value !== '') return row.value
  } catch {
    // DB not ready yet — fall through to env
  }
  return process.env[key]
}

/**
 * Set a setting value in the DB.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
}

/**
 * Get all settings as a key-value map.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings)
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

/**
 * Mask a sensitive value for display: shows first 4 + last 4 chars with ••••
 * in between, or full value if it's short/non-sensitive.
 */
export function maskValue(key: string, value: string): string {
  const sensitiveKeys = ['API_KEY', 'TOKEN', 'SECRET', 'ACCESS_KEY']
  const isSensitive = sensitiveKeys.some(k => key.toUpperCase().includes(k))
  if (!isSensitive || value.length <= 8) return value
  return value.slice(0, 4) + '••••••••' + value.slice(-4)
}

/** Returns true if a value is masked (contains bullet points) */
export function isMasked(value: string): boolean {
  return value.includes('••••')
}

/** Default setting values — seeded on first boot */
const SYSTEM_PROMPT_DEFAULT = `You are an expert localization specialist with deep knowledge of cultural nuances, idioms, and linguistic patterns. Your translations are:
- Culturally appropriate and natural-sounding in the target language
- Accurate while adapting to local conventions (dates, numbers, currency, units)
- Consistent in tone, formality level, and style
- Mindful of the target audience and regional variations
- Professional and suitable for production use
- Sensitive to context, avoiding literal translations that may confuse or mislead
- Accurate with technical terminology and industry jargon`

const MARKDOWN_USER_PROMPT_DEFAULT = `Translate the following Markdown content from {{SOURCE_LOCALE}} to {{TARGET_LOCALE}}.

PRESERVE EXACTLY:
- All Markdown syntax (headings #, **bold**, *italic*, \`code\`, etc.)
- Code blocks (fenced and indented)
- HTML tags and attributes
- URLs, email addresses, and anchor links
- Variable placeholders ({{var}}, {0}, %s, $var, :var)
- Frontmatter field names and non-translatable values (publishedDate, id, image, etc.)
- Brand names and proper nouns unless they have established translations

TRANSLATE:
- All visible text: headings, paragraphs, lists, blockquotes, table content
- Alt text for images
- Link text (but not the URL itself)
- Translatable frontmatter fields: title, description, category, tags

APPROACH:
- Adapt idioms and expressions naturally; avoid literal word-for-word translation
- Maintain the original tone and formality level
- Follow target language conventions for punctuation and spacing

Return ONLY the translated Markdown content without any explanations or commentary.`

const JSON_USER_PROMPT_DEFAULT = `Translate the JSON values from {{SOURCE_LOCALE}} to {{TARGET_LOCALE}}.

PRESERVE EXACTLY:
- All JSON keys (never translate keys)
- JSON structure and nesting
- Non-string values (numbers, booleans, null)
- Variable placeholders in any format: {{var}}, {0}, %s, $var, :var, <Tag>
- HTML tags within string values
- Empty strings

TRANSLATE:
- Only string values containing human-readable text
- Nested strings in objects and arrays

CONSIDERATIONS:
- Keep UI strings concise — they appear in buttons, labels, and menus
- Use key names as context hints (e.g., "button.submit" should be short and imperative)
- Maintain consistent terminology across related keys

Wrap your response in: {"translation": <your translated JSON>}
Return only valid JSON. Do not include any explanations outside the JSON.`

const DEFAULTS: Record<string, string> = {
  SYSTEM_PROMPT: SYSTEM_PROMPT_DEFAULT,
  MARKDOWN_USER_PROMPT: MARKDOWN_USER_PROMPT_DEFAULT,
  JSON_USER_PROMPT: JSON_USER_PROMPT_DEFAULT,
  OPENROUTER_MODEL: 'openai/gpt-4o-mini',
  OPENAI_BATCH_MODEL: 'gpt-4o-mini',
  ANTHROPIC_BATCH_MODEL: 'claude-3-haiku-20240307',
  BATCH_PROVIDER: 'auto',
  MOCK_MODE: 'false',
  GIT_FORGE: 'none',
  GIT_CREATE_ISSUES: 'false',
}

/** Insert default settings if not already present. Called on bootstrap. */
export async function seedDefaultSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const [existing] = await db.select().from(settings).where(eq(settings.key, key))
    if (!existing) {
      await db.insert(settings).values({ key, value })
    }
  }
}
