import type { FileType, ContentUploadRequest, GlobalUploadRequest, PageUploadRequest } from '../types'

/**
 * Validates if a file is a valid content file (.md)
 */
export function validateContentFile(file: File): boolean {
  return file.name.endsWith('.md') && (file.type === 'text/markdown' || file.type === 'text/plain' || file.type === '')
}

/**
 * Validates if a file is a valid JSON file
 */
export function validateJsonFile(file: File): boolean {
  if (!file.name.endsWith('.json')) {
    return false
  }

  const allowedTypes = new Set([
    '',
    'application/json',
    'application/octet-stream',
    'text/json',
    'application/x-json',
    'application/vnd.api+json',
    'text/plain'
  ])

  const normalizedType = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? ''

  if (allowedTypes.has(normalizedType)) {
    return true
  }

  if (normalizedType.includes('json')) {
    return true
  }

  return false
}

/**
 * Validates if a file matches the global translation pattern [locale].json
 */
export function validateGlobalFile(file: File, locale: string): boolean {
  const expectedName = `${locale}.json`
  return file.name === expectedName && validateJsonFile(file)
}

/**
 * Validates if a file matches the page translation pattern [locale].json
 */
export function validatePageFile(file: File, locale: string): boolean {
  const expectedName = `${locale}.json`
  return file.name === expectedName && validateJsonFile(file)
}

/**
 * Extracts locale from query parameters or form data
 */
export function extractLocale(body: Record<string, unknown>): string | null {
  if (typeof body.locale === 'string') {
    return body.locale
  }
  return null
}

/**
 * Extracts senderId from query parameters or form data
 */
export function extractSenderId(body: Record<string, unknown>): string | null {
  if (typeof body.senderId === 'string') {
    return body.senderId
  }
  return null
}

/**
 * Parses content upload request from form data
 * Expected structure: content/[locale]/[folder_name]/[files].md
 */
export function parseContentUpload(
  body: Record<string, unknown>,
  locale: string,
  senderId: string
): ContentUploadRequest | string {
  const files: ContentUploadRequest['files'] = []
  
  for (const [key, value] of Object.entries(body)) {
    if (value instanceof File && key !== 'locale' && key !== 'senderId') {
      if (!validateContentFile(value)) {
        return `Invalid content file: ${value.name}. Expected .md files.`
      }
      
      const folderInfo = deriveFolderInfoFromField(key, value)
      if (typeof folderInfo === 'string') {
        return folderInfo
      }

      files.push({
        file: value,
        folderPath: folderInfo.folderPath,
        relativePath: folderInfo.relativePath,
        fieldKey: key
      })
    }
  }
  
  if (files.length === 0) {
    return 'No valid content files provided'
  }
  
  return {
    locale,
    senderId,
    files
  }
}

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function deriveFolderInfoFromField(fieldKey: string, file: File):
  | { folderPath: string; relativePath: string }
  | string {
  if (!fieldKey.startsWith('folder_')) {
    return `Invalid field name: ${fieldKey}. Expected format: folder_[folder_and_file_identifier]`
  }

  const keyWithoutPrefix = fieldKey.replace(/^folder_/, '')
  if (!keyWithoutPrefix) {
    return 'Folder information could not be determined from uploaded file field'
  }

  const keySegments = keyWithoutPrefix.split('_').filter(Boolean)
  const baseName = file.name.replace(/\.[^./]+$/, '')
  const normalizedBase = normalizeSegment(baseName)
  const baseSegments = normalizedBase.length > 0 ? normalizedBase.split('_').filter(Boolean) : []

  let folderSegments: string[] = []

  if (baseSegments.length > 0 && keySegments.length >= baseSegments.length) {
    const suffixSegments = keySegments.slice(-baseSegments.length)
    if (suffixSegments.join('_') === baseSegments.join('_')) {
      folderSegments = keySegments.slice(0, keySegments.length - baseSegments.length)
    }
  }

  // Fallback: treat everything except the final segment as folder information
  if (folderSegments.length === 0 && keySegments.length > 1) {
    folderSegments = keySegments.slice(0, keySegments.length - 1)
  }

  const folderPath = folderSegments.join('/')
  const relativePath = folderPath ? `${folderPath}/${file.name}` : file.name

  return {
    folderPath,
    relativePath
  }
}

/**
 * Parses global upload request from form data
 * Expected structure: [locale].json
 */
export function parseGlobalUpload(
  body: Record<string, unknown>,
  locale: string,
  senderId: string
): GlobalUploadRequest | string {
  let globalFile: File | null = null
  
  for (const [key, value] of Object.entries(body)) {
    if (value instanceof File && key !== 'locale' && key !== 'senderId') {
      if (!validateGlobalFile(value, locale)) {
        return `Invalid global file: ${value.name}. Expected ${locale}.json`
      }
      
      if (globalFile) {
        return 'Multiple files provided. Expected a single global translation file.'
      }
      
      globalFile = value
    }
  }
  
  if (!globalFile) {
    return 'No valid global translation file provided'
  }
  
  return {
    locale,
    senderId,
    file: globalFile
  }
}

/**
 * Parses page upload request from form data
 * Expected structure: multiple folders, each containing [locale].json
 */
export function parsePageUpload(
  body: Record<string, unknown>,
  locale: string,
  senderId: string
): PageUploadRequest | string {
  const folders: Array<{ folderName: string; file: File }> = []
  
  for (const [key, value] of Object.entries(body)) {
    if (value instanceof File && key !== 'locale' && key !== 'senderId') {
      if (!validatePageFile(value, locale)) {
        return `Invalid page file: ${value.name}. Expected ${locale}.json files`
      }
      
      // Extract folder name from field name (assuming format: folder_[folderName])
      if (key.startsWith('folder_')) {
        const folderName = key.replace('folder_', '')
        if (!folderName) {
          return 'Folder name could not be determined'
        }
        
        folders.push({ folderName, file: value })
      } else {
        return `Invalid field name: ${key}. Expected format: folder_[folderName]`
      }
    }
  }
  
  if (folders.length === 0) {
    return 'No valid page translation files provided'
  }
  
  return {
    locale,
    senderId,
    folders
  }
}

/**
 * Checks if a parsed JSON object/array is effectively empty and doesn't need translation
 * Returns true if the JSON is empty, null, or contains only empty structures
 */
export function isJsonEmpty(data: unknown): boolean {
  if (data === null || data === undefined) {
    return true
  }

  if (Array.isArray(data)) {
    return data.length === 0 || data.every(item => isJsonEmpty(item))
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>
    const keys = Object.keys(obj)
    
    if (keys.length === 0) {
      return true
    }
    
    // Check if all values are empty
    return keys.every(key => isJsonEmpty(obj[key]))
  }

  // For primitive values (string, number, boolean), consider empty strings as empty
  if (typeof data === 'string') {
    return data.trim().length === 0
  }

  // Non-empty primitive values (numbers, booleans) are not considered empty
  return false
}