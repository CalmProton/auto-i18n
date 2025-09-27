import type { GlobalUploadRequest, PageUploadRequest, SavedFileInfo } from '../../types'
import { SUPPORTED_LOCALES } from '../../config/locales'
import { saveTextToTemp } from '../../utils/fileStorage'
import { getTranslationProvider } from './providers'

function getTargetLocales(sourceLocale: string): string[] {
  return SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== sourceLocale)
}

async function parseJsonFile(file: File, descriptor: string): Promise<unknown | null> {
  try {
    const text = await file.text()
    return JSON.parse(text)
  } catch (error) {
    console.error(`[translation] Unable to parse JSON for ${descriptor}:`, error)
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
  console.error(`[translation] Expected JSON object/array for ${descriptor} but received ${typeof value}`)
  return false
}

export async function translateGlobalFile(request: GlobalUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  if (provider.isFallback) {
    console.warn('[translation] Provider not configured. Skipping global translation step.')
    return []
  }

  if (targetLocales.length === 0) {
    return []
  }

  const parsed = await parseJsonFile(request.file, `global/${request.file.name}`)
  if (!parsed || !ensureObjectOrArray(parsed, `global/${request.file.name}`)) {
    return []
  }

  const translated: SavedFileInfo[] = []

  for (const targetLocale of targetLocales) {
    try {
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
        filename: buildJsonFilename(targetLocale),
        content: serializeJson(result)
      })

      translated.push(saved)
    } catch (error) {
      console.error(`[translation] Failed to translate global file to ${targetLocale}:`, error)
    }
  }

  return translated
}

export async function translatePageFiles(request: PageUploadRequest): Promise<SavedFileInfo[]> {
  const provider = getTranslationProvider()
  const targetLocales = getTargetLocales(request.locale)

  if (provider.isFallback) {
    console.warn('[translation] Provider not configured. Skipping page translation step.')
    return []
  }

  if (targetLocales.length === 0) {
    return []
  }

  const prepared = await Promise.all(
    request.folders.map(async (folder) => ({
      folder,
      parsed: await parseJsonFile(folder.file, `page/${folder.folderName}/${folder.file.name}`)
    }))
  )

  const translated: SavedFileInfo[] = []

  for (const targetLocale of targetLocales) {
    for (const item of prepared) {
      if (!item.parsed || !ensureObjectOrArray(item.parsed, `page/${item.folder.folderName}/${item.folder.file.name}`)) {
        continue
      }

      try {
        const result = await provider.translateJson({
          senderId: request.senderId,
          sourceLocale: request.locale,
          targetLocale,
          filePath: `${item.folder.folderName}/${item.folder.file.name}`,
          data: item.parsed
        })

        if (!ensureObjectOrArray(result, `translated page ${item.folder.folderName}/${targetLocale}`)) {
          continue
        }

        const saved = await saveTextToTemp({
          senderId: request.senderId,
          locale: targetLocale,
          type: 'page',
          folderName: item.folder.folderName,
          filename: buildJsonFilename(targetLocale),
          content: serializeJson(result)
        })

        translated.push(saved)
      } catch (error) {
        console.error(
          `[translation] Failed to translate page folder "${item.folder.folderName}" to ${targetLocale}:`,
          error
        )
      }
    }
  }

  return translated
}
