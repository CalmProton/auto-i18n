import type { ContentUploadRequest, SavedFileInfo } from '../../types'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { saveTextToTemp } from '../../utils/fileStorage'
import { getTranslationProvider } from './providers'
import { createScopedLogger } from '../../utils/logger'

function getTargetLocales(sourceLocale: string): string[] {
  return SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== sourceLocale)
}

const log = createScopedLogger('translation:content')

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

  for (const targetLocale of targetLocales) {
    if (translationFailed) break
    
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

        const saved = await saveTextToTemp({
          senderId: request.senderId,
          locale: targetLocale,
          type: 'content',
          category: 'translations',
          folderName: item.entry.folderPath,
          filename: item.entry.file.name,
          content: translated
        })

        translatedFiles.push(saved)
        log.info('Saved translated markdown file', {
          senderId: request.senderId,
          targetLocale,
          path: saved.path,
          size: saved.size
        })
      } catch (error) {
        log.error('Failed to translate markdown file', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          path: item.relativePath,
          error
        })
        translationFailed = true
        break
      }
    }
  }

  return translatedFiles
}
