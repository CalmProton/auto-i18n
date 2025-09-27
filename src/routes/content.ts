import { Hono } from 'hono'
import { processContentFiles, triggerContentTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseContentUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'

const contentRoutes = new Hono()

// Upload endpoint for content files
// Structure: content/[locale]/[folder_name]/[files].md
contentRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    // Extract locale and sender from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    const senderId = c.req.query('senderId') || extractSenderId(body)
    if (!locale) {
      const errorResponse: ErrorResponse = {
        error: 'Locale parameter is required'
      }
      return c.json(errorResponse, 400)
    }
    if (!isSupportedLocale(locale)) {
      const errorResponse: ErrorResponse = {
        error: `Locale "${locale}" is not supported`
      }
      return c.json(errorResponse, 400)
    }
    if (!senderId) {
      const errorResponse: ErrorResponse = {
        error: 'Sender identifier is required'
      }
      return c.json(errorResponse, 400)
    }
    
    // Parse and validate content upload request
    const contentRequest = parseContentUpload(body, locale, senderId)
    if (typeof contentRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: contentRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the files
    const result = await processContentFiles(contentRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }

    const folderSummary = result.folderSummary ?? (() => {
      const counts = new Map<string, number>()
      for (const entry of contentRequest.files) {
        const key = entry.folderPath ? entry.folderPath : '/'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return Array.from(counts.entries()).map(([name, fileCount]) => ({
        name,
        fileCount
      }))
    })()
    const singleFolderName = folderSummary.length === 1 ? folderSummary[0].name : undefined
    
    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: contentRequest.locale,
      folderName: singleFolderName,
      filesProcessed: contentRequest.files.length,
      files: contentRequest.files.map(({ file, folderPath, relativePath }) => ({
        name: file.name,
        size: file.size,
        folder: folderPath || undefined,
        relativePath
      })),
      folders: folderSummary,
      savedFiles: result.savedFiles,
      translatedFiles: result.translatedFiles,
      translationPending: true
    }
    
  return c.json(response, 202)
    
  } catch (error) {
    console.error('Error processing content files:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process content files'
    }
    return c.json(errorResponse, 500)
  }
})

contentRoutes.post('/trigger', async (c) => {
  try {
    const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown> | null
    const locale = c.req.query('locale')
      || (payload && typeof payload.locale === 'string' ? payload.locale : null)
    const senderId = c.req.query('senderId')
      || (payload && typeof payload.senderId === 'string' ? payload.senderId : null)

    if (!locale) {
      const errorResponse: ErrorResponse = {
        error: 'Locale parameter is required'
      }
      return c.json(errorResponse, 400)
    }
    if (!isSupportedLocale(locale)) {
      const errorResponse: ErrorResponse = {
        error: `Locale "${locale}" is not supported`
      }
      return c.json(errorResponse, 400)
    }
    if (!senderId) {
      const errorResponse: ErrorResponse = {
        error: 'Sender identifier is required'
      }
      return c.json(errorResponse, 400)
    }

    const result = await triggerContentTranslation({ senderId, locale })

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      if (result.statusCode === 404) {
        return c.json(errorResponse, 404)
      }
      if (result.statusCode === 400) {
        return c.json(errorResponse, 400)
      }
      return c.json(errorResponse, 500)
    }

    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      folders: result.folderSummary,
      savedFiles: result.savedFiles,
      translationPending: true
    }

    return c.json(response)
  } catch (error) {
    console.error('Error triggering content translation:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger content translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default contentRoutes