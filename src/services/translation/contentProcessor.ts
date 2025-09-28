import type { ContentUploadRequest, SavedFileInfo } from '../../types'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { saveTextToTemp } from '../../utils/fileStorage'
import { getTranslationProvider } from './providers'
import { createScopedLogger } from '../../utils/logger'

function getTargetLocales(sourceLocale: string): string[] {
  return SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== sourceLocale)
}

const log = createScopedLogger('translation:content')

function sanitizeMarkdownContent(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const originalEndsWithNewline = /\r?\n$/.test(content)
  const lines = content.split(/\r?\n/)

  if (lines.length > 1 && lines[0]?.trim() === '---' && lines[1]?.trim() === '---') {
    lines.splice(1, 1)
  }

  let lastIndex = lines.length - 1
  while (lastIndex >= 0 && lines[lastIndex]?.trim() === '') {
    lastIndex -= 1
  }

  if (lastIndex > 0 && lines[lastIndex]?.trim() === '---' && lines[lastIndex - 1]?.trim() === '::') {
    lines.splice(lastIndex, 1)
  }

  let sanitized = lines.join(newline)
  if (originalEndsWithNewline && !sanitized.endsWith(newline)) {
    sanitized += newline
  }

  return sanitized
}

export async function translateContentFiles(request: ContentUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  log.info('Preparing markdown translation batch', {
    senderId: request.senderId,
    sourceLocale: request.locale,
    fileCount: request.files.length,
    targetLocales,
    provider: provider.name,
    isFallback: provider.isFallback
  })

  if (provider.isFallback) {
    log.warn('Translation provider not configured. Skipping markdown translation step.', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  if (targetLocales.length === 0) {
    log.info('No target locales available for markdown translation', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  const prepared = await Promise.all(
    request.files.map(async (entry) => ({
      entry,
      text: await entry.file.text(),
      relativePath: entry.relativePath || entry.file.name
    }))
  )

  const translatedFiles: SavedFileInfo[] = []
  let translationFailed = false

  const totalTranslations = targetLocales.length * prepared.length
  let completedTranslations = 0

  log.info('Starting content translation batch', {
    senderId: request.senderId,
    sourceLocale: request.locale,
    targetLocaleCount: targetLocales.length,
    fileCount: prepared.length,
    totalTranslations
  })

  for (const targetLocale of targetLocales) {
    if (translationFailed) break
    
    log.info('Processing target locale for content', {
      senderId: request.senderId,
      sourceLocale: request.locale,
      targetLocale,
      progress: `${completedTranslations}/${totalTranslations}`
    })
    
    for (const item of prepared) {
      try {
        log.info('Translating markdown content', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          path: item.relativePath,
          characters: item.text.length
        })
        const translated = await provider.translateMarkdown({
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          filePath: item.relativePath,
          content: item.text
        })

        const sanitizedContent = sanitizeMarkdownContent(translated)

        const saved = await saveTextToTemp({
          senderId: request.senderId,
          locale: targetLocale,
          type: 'content',
          category: 'translations',
          folderName: item.entry.folderPath,
          filename: item.entry.file.name,
          content: sanitizedContent
        })

        translatedFiles.push(saved)
        completedTranslations++
        log.info('Saved translated markdown file', {
          senderId: request.senderId,
          targetLocale,
          path: saved.path,
          size: saved.size,
          progress: `${completedTranslations}/${totalTranslations}`,
          remaining: totalTranslations - completedTranslations
        })
      } catch (error) {
        completedTranslations++
        log.error('Failed to translate markdown file', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          path: item.relativePath,
          error,
          progress: `${completedTranslations}/${totalTranslations}`,
          remaining: totalTranslations - completedTranslations
        })
        translationFailed = true
        break
      }
    }
  }

  return translatedFiles
}
