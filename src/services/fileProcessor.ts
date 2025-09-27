import type {
  ProcessingResult,
  ContentUploadRequest,
  GlobalUploadRequest,
  PageUploadRequest,
  SavedFileInfo
} from '../types'
import { saveFileToTemp, saveFilesToTemp } from '../utils/fileStorage'
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
      { senderId, locale, type: 'content' },
      files.map(({ file, folderPath }) => ({ file, folderName: folderPath }))
    )

    let translatedFiles: SavedFileInfo[] = []
    try {
      translatedFiles = await translateContentFiles(request)
    } catch (translationError) {
      console.error('Error translating content files:', translationError)
    }

    for (let index = 0; index < files.length; index += 1) {
      const { file, folderPath, relativePath } = files[index]
      const saved = savedFiles[index]
      const displayPath = relativePath || file.name
      console.log(
        `- Content file: ${displayPath} (${file.size} bytes) saved to ${saved.path}`
      )
    }

    if (translatedFiles.length > 0) {
      console.log(`Generated ${translatedFiles.length} translated content file(s).`)
    }
    
    return {
      success: true,
      message: `Successfully processed ${files.length} content files across ${uniqueFolderCount} folder(s)`,
      processedCount: files.length,
      senderId,
      locale,
      folderSummary,
      savedFiles,
      translatedFiles
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
  const savedFile = await saveFileToTemp({ senderId, locale, type: 'global', file })
    let translatedFiles: SavedFileInfo[] = []
    try {
      translatedFiles = await translateGlobalFile(request)
    } catch (translationError) {
      console.error('Error translating global file:', translationError)
    }

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

    if (translatedFiles.length > 0) {
      console.log(`Generated ${translatedFiles.length} translated global file(s).`)
    }

    return {
      success: true,
      message: `Successfully processed global translation file for ${locale}`,
      processedCount: 1,
      senderId,
      locale,
      savedFiles: [savedFile],
      translatedFiles
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
      { senderId, locale, type: 'page' },
      folders.map(({ file, folderName }) => ({ file, folderName }))
    )
    let translatedFiles: SavedFileInfo[] = []
    try {
      translatedFiles = await translatePageFiles(request)
    } catch (translationError) {
      console.error('Error translating page files:', translationError)
    }

    for (let index = 0; index < folders.length; index += 1) {
      const { folderName, file } = folders[index]
      const saved = savedFiles[index]
      console.log(
        `- Page translation folder: ${folderName}, file: ${file.name} (${file.size} bytes) saved to ${saved.path}`
      )
    }

    if (translatedFiles.length > 0) {
      console.log(`Generated ${translatedFiles.length} translated page file(s).`)
    }

    return {
      success: true,
      message: `Successfully processed ${folders.length} page translation folders for ${locale}`,
      processedCount: folders.length,
      senderId,
      locale,
      savedFiles,
      translatedFiles
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