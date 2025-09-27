import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ProcessingResult,
  ContentUploadRequest,
  GlobalUploadRequest,
  PageUploadRequest,
  SavedFileInfo
} from '../types'
import { resolveUploadPath, saveFileToTemp, saveFilesToTemp } from '../utils/fileStorage'
import { translateContentFiles } from './translation/contentProcessor'
import { translateGlobalFile, translatePageFiles } from './translation/jsonProcessor'

/**
 * Processes content files from a single folder
 * Structure: content/[locale]/[folder_name]/[files].md
 */
export async function processContentFiles(request: ContentUploadRequest): Promise<ProcessingResult> {
  const { locale, files, senderId } = request
  const folderSummaryMap = new Map<string, number>()

  for (const { folderPath } of files) {
    const key = folderPath || '.'
    folderSummaryMap.set(key, (folderSummaryMap.get(key) ?? 0) + 1)
  }

  const folderSummary = Array.from(folderSummaryMap.entries()).map(([name, fileCount]) => ({
    name: name === '.' ? '/' : name,
    fileCount
  }))

  const uniqueFolderCount = folderSummary.length
  const folderDescriptor = uniqueFolderCount === 1
    ? (folderSummary[0]?.name || 'root')
    : `${uniqueFolderCount} folders`

  console.log(
    `Processing ${files.length} content files (.md) from ${folderDescriptor} for locale: ${locale} (sender: ${senderId})`
  )
  
  try {
    const savedFiles = await saveFilesToTemp(
      { senderId, locale, type: 'content', category: 'uploads' },
      files.map(({ file, folderPath }) => ({ file, folderName: folderPath }))
    )

    for (let index = 0; index < files.length; index += 1) {
      const { file, folderPath, relativePath } = files[index]
      const saved = savedFiles[index]
      const displayPath = relativePath || file.name
      console.log(
        `- Content file: ${displayPath} (${file.size} bytes) saved to ${saved.path}`
      )
    }

    return {
      success: true,
      message: `Successfully saved ${files.length} content file(s) across ${uniqueFolderCount} folder(s) for ${locale}. Translation pending trigger.`,
      processedCount: files.length,
      senderId,
      locale,
      folderSummary,
      savedFiles,
      translatedFiles: []
    }
  } catch (error) {
    console.error('Error processing content files:', error)
    return {
      success: false,
      message: `Failed to process content files: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale,
      folderSummary
    }
  }
}

/**
 * Processes global translation file
 * Structure: [locale].json
 */
export async function processGlobalTranslation(request: GlobalUploadRequest): Promise<ProcessingResult> {
  const { locale, file, senderId } = request
  console.log(`Processing global translation file: ${file.name} for locale: ${locale} (sender: ${senderId})`)
  
  try {
  const savedFile = await saveFileToTemp({ senderId, locale, type: 'global', file, category: 'uploads' })

    const content = await file.text()
    console.log(`- Global translation content length: ${content.length} characters`)
    console.log(`- Saved global translation to ${savedFile.path}`)
    
    // TODO: Implement global translation processing logic
    try {
      const translations = JSON.parse(content)
      console.log(`- Found ${Object.keys(translations).length} translation keys`)
    } catch (error) {
      console.warn('Unable to parse uploaded global translation JSON for logging.', error)
    }

    return {
      success: true,
      message: `Successfully saved global translation file for ${locale}. Translation pending trigger.`,
      processedCount: 1,
      senderId,
      locale,
      savedFiles: [savedFile],
      translatedFiles: []
    }
  } catch (error) {
    console.error('Error processing global translation file:', error)
    return {
      success: false,
      message: `Failed to process global translation file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale
    }
  }
}

/**
 * Processes page translation files from multiple folders
 * Structure: multiple folders, each containing [locale].json
 */
export async function processPageTranslations(request: PageUploadRequest): Promise<ProcessingResult> {
  const { locale, folders, senderId } = request
  console.log(`Processing ${folders.length} page translation folders for locale: ${locale} (sender: ${senderId})`)
  
  try {
    const savedFiles: SavedFileInfo[] = await saveFilesToTemp(
      { senderId, locale, type: 'page', category: 'uploads' },
      folders.map(({ file, folderName }) => ({ file, folderName }))
    )
    const translatedFiles: SavedFileInfo[] = []

    for (let index = 0; index < folders.length; index += 1) {
      const { folderName, file } = folders[index]
      const saved = savedFiles[index]
      console.log(
        `- Page translation folder: ${folderName}, file: ${file.name} (${file.size} bytes) saved to ${saved.path}`
      )
    }

    return {
      success: true,
      message: `Successfully saved ${folders.length} page translation folder(s) for ${locale}. Translation pending trigger.`,
      processedCount: folders.length,
      senderId,
      locale,
      savedFiles,
      translatedFiles: []
    }
  } catch (error) {
    console.error('Error processing page translation files:', error)
    return {
      success: false,
      message: `Failed to process page translation files: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale
    }
  }
}

type ContentSourceFile = {
  folderPath: string
  filePath: string
  fileName: string
  size: number
}

async function collectContentSourceFiles(
  directory: string,
  relativeFolder = ''
): Promise<ContentSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const collected: ContentSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectContentSourceFiles(entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const blob = Bun.file(entryPath)
      collected.push({
        folderPath: relativeFolder,
        filePath: entryPath,
        fileName: entry.name,
        size: blob.size
      })
    }
  }

  return collected
}

export async function triggerContentTranslation(options: {
  senderId: string
  locale: string
}): Promise<ProcessingResult> {
  const { senderId, locale } = options
  const rootDir = resolveUploadPath({ senderId, locale, type: 'content', category: 'uploads' })

  if (!existsSync(rootDir)) {
    return {
      success: false,
      message: `No saved content uploads found for sender "${senderId}" and locale "${locale}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  let sources: ContentSourceFile[]
  try {
    sources = await collectContentSourceFiles(rootDir)
  } catch (error) {
    console.error('Error reading saved content uploads:', error)
    return {
      success: false,
      message: `Failed to read saved content uploads: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale,
      statusCode: 500
    }
  }

  if (sources.length === 0) {
    return {
      success: false,
      message: `No markdown files were found for sender "${senderId}" and locale "${locale}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  const folderSummaryMap = new Map<string, number>()
  for (const source of sources) {
    const key = source.folderPath || '/'
    folderSummaryMap.set(key, (folderSummaryMap.get(key) ?? 0) + 1)
  }

  const folderSummary = Array.from(folderSummaryMap.entries()).map(([name, fileCount]) => ({
    name,
    fileCount
  }))

  const savedFiles: SavedFileInfo[] = sources.map(({ folderPath, filePath, fileName, size }) => ({
    name: fileName,
    size,
    path: filePath,
    folder: folderPath || undefined,
    type: 'content'
  }))

  const runTranslation = async () => {
    try {
      const files: ContentUploadRequest['files'] = await Promise.all(
        sources.map(async ({ folderPath, filePath, fileName }) => {
          const arrayBuffer = await Bun.file(filePath).arrayBuffer()
          const file = new File([arrayBuffer], fileName, { type: 'text/markdown' })
          const relativePath = folderPath ? `${folderPath}/${fileName}` : fileName

          return {
            file,
            folderPath,
            relativePath
          }
        })
      )

      await translateContentFiles({
        locale,
        senderId,
        files
      })
      console.log(
        `[translation] Content translation task finished for sender ${senderId}, locale ${locale} (${files.length} file(s))`
      )
    } catch (error) {
      console.error('[translation] Background content translation failed:', error)
    }
  }

  void runTranslation()

  return {
    success: true,
    message: `Translation task scheduled for ${sources.length} content file(s) for ${locale}`,
    processedCount: sources.length,
    senderId,
    locale,
    folderSummary,
    savedFiles,
    translatedFiles: []
  }
}

type PageSourceFile = {
  folderName: string
  filePath: string
  fileName: string
  size: number
}

async function collectPageSourceFiles(
  directory: string,
  locale: string,
  relativePath = ''
): Promise<PageSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const collected: PageSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      const nextRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name
      const nested = await collectPageSourceFiles(entryPath, locale, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name === `${locale}.json`) {
      const blob = Bun.file(entryPath)
      collected.push({
        folderName: relativePath,
        filePath: entryPath,
        fileName: entry.name,
        size: blob.size
      })
    }
  }

  return collected
}

export async function triggerPageTranslation(options: {
  senderId: string
  locale: string
}): Promise<ProcessingResult> {
  const { senderId, locale } = options
  const rootDir = resolveUploadPath({ senderId, locale, type: 'page', category: 'uploads' })

  if (!existsSync(rootDir)) {
    return {
      success: false,
      message: `No saved page uploads found for sender "${senderId}" and locale "${locale}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  let sources: PageSourceFile[]
  try {
    sources = await collectPageSourceFiles(rootDir, locale)
  } catch (error) {
    console.error('Error reading saved page uploads:', error)
    return {
      success: false,
      message: `Failed to read saved page uploads: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale,
      statusCode: 500
    }
  }

  if (sources.length === 0) {
    return {
      success: false,
      message: `No source page files named "${locale}.json" were found for sender "${senderId}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  const savedFiles: SavedFileInfo[] = sources.map(({ folderName, filePath, fileName, size }) => ({
    name: fileName,
    size,
    path: filePath,
    folder: folderName || undefined,
    type: 'page'
  }))

  const runTranslation = async () => {
    try {
      const folders = await Promise.all(
        sources.map(async ({ folderName, filePath, fileName }) => {
          const arrayBuffer = await Bun.file(filePath).arrayBuffer()
          const file = new File([arrayBuffer], fileName, { type: 'application/json' })
          return {
            folderName,
            file
          }
        })
      )

      await translatePageFiles({
        locale,
        senderId,
        folders
      })
      console.log(
        `[translation] Page translation task finished for sender ${senderId}, locale ${locale} (${folders.length} folder(s))`
      )
    } catch (error) {
      console.error('[translation] Background page translation failed:', error)
    }
  }

  void runTranslation()

  return {
    success: true,
    message: `Translation task scheduled for ${sources.length} page folder(s) for ${locale}`,
    processedCount: sources.length,
    senderId,
    locale,
    savedFiles,
    translatedFiles: []
  }
}

export async function triggerGlobalTranslation(options: {
  senderId: string
  locale: string
}): Promise<ProcessingResult> {
  const { senderId, locale } = options
  const directory = resolveUploadPath({ senderId, locale, type: 'global', category: 'uploads' })

  if (!existsSync(directory)) {
    return {
      success: false,
      message: `No saved global uploads found for sender "${senderId}" and locale "${locale}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  let candidateFile: { filePath: string; fileName: string; size: number } | null = null

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }

      const filePath = join(directory, entry.name)
      const fileName = entry.name
      const size = Bun.file(filePath).size

      if (fileName === `${locale}.json`) {
        candidateFile = { filePath, fileName, size }
        break
      }

      if (!candidateFile && fileName.toLowerCase().endsWith('.json')) {
        candidateFile = { filePath, fileName, size }
      }
    }
  } catch (error) {
    console.error('Error reading saved global uploads:', error)
    return {
      success: false,
      message: `Failed to read saved global uploads: ${error instanceof Error ? error.message : 'Unknown error'}`,
      senderId,
      locale,
      statusCode: 500
    }
  }

  if (!candidateFile) {
    return {
      success: false,
      message: `No JSON files were found for sender "${senderId}" and locale "${locale}"`,
      senderId,
      locale,
      statusCode: 404
    }
  }

  const savedFiles: SavedFileInfo[] = [{
    name: candidateFile.fileName,
    size: candidateFile.size,
    path: candidateFile.filePath,
    type: 'global'
  }]

  const runTranslation = async () => {
    try {
      const arrayBuffer = await Bun.file(candidateFile.filePath).arrayBuffer()
      const file = new File([arrayBuffer], candidateFile.fileName, { type: 'application/json' })

      await translateGlobalFile({
        locale,
        senderId,
        file
      })
      console.log(
        `[translation] Global translation task finished for sender ${senderId}, locale ${locale} (file: ${candidateFile.fileName})`
      )
    } catch (error) {
      console.error('[translation] Background global translation failed:', error)
    }
  }

  void runTranslation()

  return {
    success: true,
    message: `Translation task scheduled for global file "${candidateFile.fileName}" for ${locale}`,
    processedCount: 1,
    senderId,
    locale,
    savedFiles,
    translatedFiles: []
  }
}