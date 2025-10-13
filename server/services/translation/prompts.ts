import { SUPPORTED_LOCALES } from '../../config/locales'

function localeDisplayName(code: string): string {
  return SUPPORTED_LOCALES.find((item) => item.code === code)?.name ?? code
}

export const TRANSLATION_SYSTEM_PROMPT = `You are an expert localization specialist with deep knowledge of cultural nuances, idioms, and linguistic patterns. Your translations are:
- Culturally appropriate and natural-sounding in the target language
- Accurate while adapting to local conventions (dates, numbers, currency, units)
- Consistent in tone, formality level, and style
- Mindful of the target audience and regional variations
- Professional and suitable for production use
- Sensitive to context, avoiding literal translations that may confuse or mislead
- Accurate with technical terminology and industry jargon`

export function buildMarkdownTranslationPrompt(sourceLocale: string, targetLocale: string): string {
  return `Translate the following Markdown content from ${localeDisplayName(sourceLocale)} (${sourceLocale}) to ${localeDisplayName(targetLocale)} (${targetLocale}).

CRITICAL RULES:

1. FRONTMATTER HANDLING (MUST BE INCLUDED):
   - The document ALWAYS starts with YAML frontmatter between --- markers
   - ALWAYS include the complete frontmatter block in your output
   - The frontmatter MUST appear at the very beginning of your response
   
   TRANSLATE these frontmatter fields:
   - title: translate the title text
   - description: translate the description text
   - category: translate the category name
   - tags: translate each tag in the array
   - author: translate author names (e.g., "pxGuru Team" → localized equivalent)
   - difficulty: translate difficulty levels (Beginner/Intermediate/Advanced)
   
   DO NOT MODIFY these frontmatter fields (preserve exactly):
   - publishedDate: keep the ISO date unchanged
   - modifiedDate: keep the ISO date unchanged
   - categoryKey: keep the technical value unchanged
   - readTime: keep the number unchanged
   - image: keep the URL/path unchanged
   - authorUrl: keep the URL unchanged
   - articleType: keep the technical value unchanged
   - id: keep the unique identifier unchanged
   - defaultValue: keep the technical value unchanged
   - allowCustomValues: keep the technical value unchanged
   - customValueKeys: keep the technical value unchanged
   - promptModifier: keep the technical value unchanged
   - icon, iconColor: keep the technical values unchanged

2. MDC COMPONENT HANDLING:
   - MDC components use :: syntax (e.g., ::blog-table-of-contents)
   - ALWAYS preserve the component opening (::component-name) and closing (::) markers
   - Inside MDC component YAML blocks (between --- markers within components):
     * TRANSLATE: "text" fields (visible labels)
     * PRESERVE: "href" fields (anchor links and URLs)
     * TRANSLATE: other visible content fields (titles, descriptions, labels, etc.)
     * PRESERVE: technical identifiers, classes, IDs
   
   Example structure to maintain:
   ::blog-table-of-contents
   ---
   items:
   - text: "Translated Text"
     href: "#unchanged-anchor"
   ---
   ::

3. PRESERVE EXACTLY (do not translate or modify):
   - All Markdown syntax and formatting (headers #, lists -, *, links [], images !, etc.)
   - Code blocks and inline code (everything within \`\`\` or \`)
   - HTML tags and attributes
   - URLs and email addresses (including anchor links like #section-name)
   - Variable placeholders (e.g., {{variable}}, {0}, %s, $variable, :variable)
   - MDC component names and their :: delimiters
   - Brand names, product names, and trademarked terms

4. TRANSLATE:
   - All visible text content, including headings, paragraphs, lists, blockquotes, table content
   - Alt text for images and link text
   - MDC component content fields (text, labels, descriptions, titles, etc.)
   - Frontmatter fields as specified in rule 1

5. TRANSLATION APPROACH:
   - Adapt idioms and expressions to natural equivalents in the target language
   - Adjust formality level appropriately for the target culture
   - Localize units of measurement, date formats, and number formats when appearing in prose
   - Maintain the same tone and style as the source text
   - Ensure technical terminology is translated consistently
   - For UI text, keep translations concise and appropriate for interface elements

6. QUALITY CHECKS:
   - Ensure translations sound natural to native speakers
   - Verify technical terms are industry-standard in the target language
   - Maintain text flow and readability
   - Check that sentence structure follows target language conventions

7. OUTPUT FORMAT REQUIREMENTS:
   - Start with the complete frontmatter block (--- ... ---)
   - End with the closing :: of the last MDC component followed by ONE newline
   - Do NOT add extra dashes (---) at the end of the file
   - Do NOT add explanatory text before or after the content
   - Ensure proper spacing: blank line after frontmatter, proper component spacing

Return ONLY the translated Markdown content without any explanations or meta-commentary.`
}

export function buildJsonTranslationPrompt(sourceLocale: string, targetLocale: string): string {
  return `Translate the JSON values from ${localeDisplayName(sourceLocale)} (${sourceLocale}) to ${localeDisplayName(targetLocale)} (${targetLocale}).

CRITICAL RULES:
1. PRESERVE EXACTLY (do not modify):
   - All JSON keys (property names)
   - JSON structure and nesting
   - Non-string values (numbers, booleans, null, arrays of non-strings)
   - Variable placeholders in any format ({{var}}, {0}, %s, %d, $var, :var, <0>, [var], etc.)
   - HTML tags within strings
   - Special escape sequences (\\n, \\t, \\", etc.)
   - Empty strings ""

2. TRANSLATE:
   - Only string values that contain actual translatable text
   - Nested string values within objects and arrays
   - Maintain appropriate formality and tone for the target language

3. LOCALIZATION CONSIDERATIONS:
   - For UI strings: Keep translations concise, considering UI space constraints
   - For error messages: Ensure clarity and actionability in the target language
   - For pluralization: Respect target language plural rules (some languages have multiple plural forms)
   - For concatenated strings: Ensure grammar remains correct when strings are combined

4. CONTEXT HANDLING:
   - Consider key names as context hints (e.g., "button.submit" suggests a UI button)
   - Maintain consistency for repeated terms across different keys
   - If a value appears to be a technical term or proper noun, verify if it should be translated

5. SPECIAL CASES:
   - If a string contains both translatable text and code/variables, translate only the text portions
   - For strings with markdown or HTML, translate the content while preserving formatting
   - Keep acronyms and abbreviations unless they have established translations

Return ONLY valid JSON with the same structure and all string values appropriately translated.`
}

// Enhanced wrapper directive with validation reminder
export const JSON_TRANSLATION_WRAPPER_DIRECTIVE = 
  'Wrap your translated JSON response in an object with a "translation" key: {"translation": <your_translated_json>}. Ensure the JSON is valid and properly escaped.'

// More specific response directives
export const MARKDOWN_RESPONSE_DIRECTIVE = 
  'Return only the translated Markdown content. Do not include any explanations, notes, or commentary outside the Markdown.'

export const JSON_RESPONSE_DIRECTIVE = 
  'Return only valid JSON with translated values. Do not include any explanations or text outside the JSON structure.'

export { localeDisplayName }