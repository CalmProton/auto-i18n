import type { GlobalUploadRequest, PageUploadRequest, SavedFileInfo } from '../../types'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { saveTextToTemp } from '../../utils/fileStorage'
import { isJsonEmpty } from '../../utils/fileValidation'
import { getTranslationProvider } from './providers'
import { createScopedLogger } from '../../utils/logger'

function getTargetLocales(sourceLocale: string): string[] {
  return SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== sourceLocale)
}

const log = createScopedLogger('translation:json')

async function parseJsonFile(file: File, descriptor: string): Promise<unknown | null> {
  try {
    const text = await file.text()
    return JSON.parse(text)
  } catch (error) {
    log.error('Unable to parse JSON file', {
      descriptor,
      fileName: file.name,
      error
    })
    return null
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildJsonFilename(targetLocale: string): string {
  return `${targetLocale}.json`
}

function ensureObjectOrArray(value: unknown, descriptor: string): value is Record<string, unknown> | unknown[] {
  if (value && (typeof value === 'object')) {
    return true
  }
  log.error('Expected JSON object/array but received invalid type', {
    descriptor,
    receivedType: typeof value
  })
  return false
}

export async function translateGlobalFile(request: GlobalUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  log.info('Preparing global JSON translation', {
    senderId: request.senderId,
    sourceLocale: request.locale,
    fileName: request.file.name,
    targetLocales,
    provider: provider.name,
    isFallback: provider.isFallback
  })

  if (provider.isFallback) {
    log.warn('Translation provider not configured. Skipping global translation step.', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  if (targetLocales.length === 0) {
    log.info('No target locales available for global translation', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  const parsed = await parseJsonFile(request.file, `global/${request.file.name}`)
  if (!parsed || !ensureObjectOrArray(parsed, `global/${request.file.name}`)) {
    return []
  }

  // Check if the JSON is empty and skip translation if so
  if (isJsonEmpty(parsed)) {
    log.info('Skipping empty global JSON file', {
      senderId: request.senderId,
      sourceLocale: request.locale,
      fileName: request.file.name
    })
    return []
  }

  const translated: SavedFileInfo[] = []

  for (const targetLocale of targetLocales) {
    try {
      log.info('Translating global JSON file', {
        senderId: request.senderId,
        sourceLocale: request.locale,
        targetLocale,
        fileName: request.file.name
      })
      const result = await provider.translateJson({
        senderId: request.senderId,
        sourceLocale: request.locale,
        targetLocale,
        filePath: request.file.name,
        data: parsed
      })

      if (!ensureObjectOrArray(result, `translated global ${targetLocale}`)) {
        continue
      }

      const saved = await saveTextToTemp({
        senderId: request.senderId,
        locale: targetLocale,
        type: 'global',
        category: 'translations',
        filename: buildJsonFilename(targetLocale),
        content: serializeJson(result)
      })

      translated.push(saved)
      log.info('Saved translated global JSON', {
        senderId: request.senderId,
        targetLocale,
        path: saved.path,
        size: saved.size
      })
    } catch (error) {
      log.error('Failed to translate global JSON file', {
        senderId: request.senderId,
        sourceLocale: request.locale,
        targetLocale,
        fileName: request.file.name,
        error
      })
      break
    }
  }

  return translated
}

export async function translatePageFiles(request: PageUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  log.info('Preparing page JSON translation', {
    senderId: request.senderId,
    sourceLocale: request.locale,
    folderCount: request.folders.length,
    folderNames: request.folders.map((folder) => folder.folderName),
    targetLocales,
    provider: provider.name,
    isFallback: provider.isFallback
  })

  if (provider.isFallback) {
    log.warn('Translation provider not configured. Skipping page translation step.', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  if (targetLocales.length === 0) {
    log.info('No target locales available for page translation', {
      senderId: request.senderId,
      sourceLocale: request.locale
    })
    return []
  }

  const prepared = await Promise.all(
    request.folders.map(async (folder) => ({
      folder,
      parsed: await parseJsonFile(folder.file, `page/${folder.folderName}/${folder.file.name}`)
    }))
  )

  const translated: SavedFileInfo[] = []
  let translationFailed = false

  const totalTranslations = targetLocales.length * prepared.length
  let completedTranslations = 0

  log.info('Starting batch translation', {
    senderId: request.senderId,
    sourceLocale: request.locale,
    targetLocaleCount: targetLocales.length,
    folderCount: prepared.length,
    totalTranslations
  })

  for (const targetLocale of targetLocales) {
    if (translationFailed) break
    
    log.info('Processing target locale', {
      senderId: request.senderId,
      sourceLocale: request.locale,
      targetLocale,
      progress: `${completedTranslations}/${totalTranslations}`
    })
    
    // Process all folders for this locale in parallel
    const folderPromises = prepared.map(async (item) => {
      if (!item.parsed || !ensureObjectOrArray(item.parsed, `page/${item.folder.folderName}/${item.folder.file.name}`)) {
        return null
      }

      // Check if the JSON is empty and skip translation if so
      if (isJsonEmpty(item.parsed)) {
        log.info('Skipping empty page JSON file', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          folderName: item.folder.folderName,
          fileName: item.folder.file.name
        })
        return null
      }

      try {
        log.info('Translating page JSON folder', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          folderName: item.folder.folderName,
          fileName: item.folder.file.name
        })
        const result = await provider.translateJson({
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          filePath: `${item.folder.folderName}/${item.folder.file.name}`,
          data: item.parsed
        })

        if (!ensureObjectOrArray(result, `translated page ${item.folder.folderName}/${targetLocale}`)) {
          return null
        }

        const saved = await saveTextToTemp({
          senderId: request.senderId,
          locale: targetLocale,
          type: 'page',
          category: 'translations',
          folderName: item.folder.folderName,
          filename: buildJsonFilename(targetLocale),
          content: serializeJson(result)
        })

        completedTranslations++
        log.info('Saved translated page JSON', {
          senderId: request.senderId,
          targetLocale,
          folderName: item.folder.folderName,
          path: saved.path,
          size: saved.size,
          progress: `${completedTranslations}/${totalTranslations}`,
          remaining: totalTranslations - completedTranslations
        })
        
        return saved
      } catch (error) {
        completedTranslations++
        log.error('Failed to translate page JSON folder', {
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          folderName: item.folder.folderName,
          fileName: item.folder.file.name,
          error,
          progress: `${completedTranslations}/${totalTranslations}`,
          remaining: totalTranslations - completedTranslations
        })
        throw error
      }
    })

    try {
      const results = await Promise.all(folderPromises)
      const validResults = results.filter((result): result is SavedFileInfo => result !== null)
      translated.push(...validResults)
    } catch (error) {
      log.error('Parallel translation failed for target locale', {
        senderId: request.senderId,
        sourceLocale: request.locale,
        targetLocale,
        error
      })
      translationFailed = true
      break
    }
  }

  return translated
}
