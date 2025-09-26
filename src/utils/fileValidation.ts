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
  return file.name.endsWith('.json') && (file.type === 'application/json' || file.type === '')
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
  const files: File[] = []
  let folderName: string | null = null
  
  for (const [key, value] of Object.entries(body)) {
    if (value instanceof File && key !== 'locale' && key !== 'senderId') {
      if (!validateContentFile(value)) {
        return `Invalid content file: ${value.name}. Expected .md files.`
      }
      
      // Extract folder name from field name (assuming format: folder_[folderName]_[filename])
      if (key.startsWith('folder_')) {
        const parts = key.split('_')
        if (parts.length >= 3) {
          const extractedFolder = parts[1]
          if (!folderName) {
            folderName = extractedFolder
          } else if (folderName !== extractedFolder) {
            return 'All files must be from the same folder'
          }
        }
      }
      
      files.push(value)
    }
  }
  
  if (files.length === 0) {
    return 'No valid content files provided'
  }
  
  if (!folderName) {
    return 'Folder name could not be determined from uploaded files'
  }
  
  return {
    locale,
    senderId,
    folderName,
    files
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