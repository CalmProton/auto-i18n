import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createScopedLogger } from '../../utils/logger'
import { getTempRoot } from '../../utils/fileStorage'
import type { ProcessedTranslation } from './batchOutputProcessor'

const log = createScopedLogger('translation:translationFormatter')

/**
 * Sanitizes path segments to prevent directory traversal
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Fixes duplicate frontmatter delimiters at the start of markdown files
 * Removes the first "---" if the file starts with "---\n---"
 */
function fixMarkdownFrontmatter(content: string): string {
  // Check if content starts with "---\n---" or "---\r\n---"
  if (content.startsWith('---\n---') || content.startsWith('---\r\n---')) {
    // Remove the first "---" and the newline after it
    return content.replace(/^---(\r?\n)/, '')
  }
  return content
}

/**
 * Unwraps JSON content if it's wrapped in a "translation" key
 * Some LLMs wrap the translated JSON in { "translation": {...} }
 * This function extracts the inner content
 */
function unwrapJsonTranslation(content: string): string {
  try {
    const parsed = JSON.parse(content)
    
    // Check if the parsed object has only one key called "translation"
    const keys = Object.keys(parsed)
    if (keys.length === 1 && keys[0] === 'translation' && typeof parsed.translation === 'object') {
      log.debug('Unwrapping JSON content from "translation" wrapper')
      return JSON.stringify(parsed.translation, null, 2)
    }
    
    // No unwrapping needed
    return content
  } catch (error) {
    log.warn('Failed to parse JSON for unwrapping check', { error })
    return content
  }
}

/**
 * Saves a single translated file to the translations directory
 * Structure: tmp/{senderId}/translations/{targetLocale}/{type}/{relativePath}
 */
export async function saveTranslatedFile(
  senderId: string,
  translation: ProcessedTranslation
): Promise<string> {
  const sanitizedSender = sanitizeSegment(senderId)
  
  // Build path: tmp/{senderId}/translations/{targetLocale}/{type}/{relativePath}
  const translationsRoot = join(getTempRoot(), sanitizedSender, 'translations')
  const localePath = join(translationsRoot, translation.targetLocale, translation.type)
  
  // Handle relative path - split and join to normalize
  const pathParts = translation.relativePath.split('/').filter(p => p.length > 0)
  
  // For JSON files, replace the source locale filename with target locale
  if (translation.format === 'json' && pathParts.length > 0) {
    const lastPart = pathParts[pathParts.length - 1]
    // Replace en.json (or any locale) with targetLocale.json
    if (lastPart.endsWith('.json')) {
      pathParts[pathParts.length - 1] = `${translation.targetLocale}.json`
    }
  }
  
  const filePath = join(localePath, ...pathParts)
  
  // Ensure directory exists
  const dirPath = join(localePath, ...pathParts.slice(0, -1))
  await mkdir(dirPath, { recursive: true })
  
  // Fix markdown frontmatter if this is a markdown file
  let contentToSave = translation.translatedContent
  if (translation.format === 'markdown') {
    contentToSave = fixMarkdownFrontmatter(contentToSave)
  }
  
  // Unwrap JSON content if wrapped in "translation" key
  if (translation.format === 'json') {
    contentToSave = unwrapJsonTranslation(contentToSave)
  }
  
  // Write the file
  await writeFile(filePath, contentToSave, 'utf8')
  
  log.debug('Saved translated file', {
    senderId,
    targetLocale: translation.targetLocale,
    type: translation.type,
    relativePath: translation.relativePath,
    filePath
  })
  
  return filePath
}

/**
 * Processes all translations and saves them to the translations directory
 * This creates the structure that the GitHub workflow expects
 */
export async function formatTranslationsForGithub(options: {
  senderId: string
  translations: ProcessedTranslation[]
}): Promise<{
  savedFiles: number
  failedFiles: number
  savedPaths: string[]
  errors: Array<{ translation: ProcessedTranslation; error: unknown }>
}> {
  const { senderId, translations } = options
  
  log.info('Formatting translations for GitHub workflow', {
    senderId,
    totalTranslations: translations.length
  })
  
  const savedPaths: string[] = []
  const errors: Array<{ translation: ProcessedTranslation; error: unknown }> = []
  
  for (const translation of translations) {
    if (translation.status === 'error') {
      log.warn('Skipping translation with error status', {
        customId: translation.customId,
        errorMessage: translation.errorMessage
      })
      errors.push({ translation, error: new Error(translation.errorMessage || 'Unknown error') })
      continue
    }
    
    try {
      const filePath = await saveTranslatedFile(senderId, translation)
      savedPaths.push(filePath)
    } catch (error) {
      log.error('Failed to save translated file', {
        customId: translation.customId,
        targetLocale: translation.targetLocale,
        relativePath: translation.relativePath,
        error
      })
      errors.push({ translation, error })
    }
  }
  
  const result = {
    savedFiles: savedPaths.length,
    failedFiles: errors.length,
    savedPaths,
    errors
  }
  
  log.info('Translation formatting complete', {
    senderId,
    savedFiles: result.savedFiles,
    failedFiles: result.failedFiles
  })
  
  return result
}

/**
 * Gets a summary of translations grouped by locale and type
 */
export function getTranslationSummary(translations: ProcessedTranslation[]): {
  byLocale: Record<string, number>
  byType: Record<string, number>
  totalSuccess: number
  totalError: number
} {
  const byLocale: Record<string, number> = {}
  const byType: Record<string, number> = {}
  let totalSuccess = 0
  let totalError = 0
  
  for (const translation of translations) {
    if (translation.status === 'success') {
      totalSuccess++
      byLocale[translation.targetLocale] = (byLocale[translation.targetLocale] || 0) + 1
      byType[translation.type] = (byType[translation.type] || 0) + 1
    } else {
      totalError++
    }
  }
  
  return { byLocale, byType, totalSuccess, totalError }
}
