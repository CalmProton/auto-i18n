import type { ContentUploadRequest, SavedFileInfo } from '../../types'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { saveTextToTemp } from '../../utils/fileStorage'
import { getTranslationProvider } from './providers'

function getTargetLocales(sourceLocale: string): string[] {
  return SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== sourceLocale)
}

export async function translateContentFiles(request: ContentUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  if (provider.isFallback) {
    console.warn('[translation] Provider not configured. Skipping markdown translation step.')
    return []
  }

  if (targetLocales.length === 0) {
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
      } catch (error) {
        console.error(
          `[translation] Failed to translate content file "${item.relativePath}" to ${targetLocale}. Stopping translation process for remaining locales.`,
          error
        )
        translationFailed = true
        break
      }
    }
  }

  return translatedFiles
}
