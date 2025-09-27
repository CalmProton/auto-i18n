import { Hono } from 'hono'
import { processPageTranslations, triggerPageTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parsePageUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'

const pageTranslationRoutes = new Hono()

// Upload endpoint for page translation files
// Structure: multiple folders, each containing [locale].json
pageTranslationRoutes.post('/', async (c) => {
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
    
    // Parse and validate page upload request
  const pageRequest = parsePageUpload(body, locale, senderId)
    if (typeof pageRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: pageRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the files
    const result = await processPageTranslations(pageRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }
    
    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: pageRequest.locale,
      filesProcessed: pageRequest.folders.length,
      folders: pageRequest.folders.map((f) => ({ name: f.folderName, fileCount: 1 })),
      savedFiles: result.savedFiles,
      translatedFiles: result.translatedFiles,
      translationPending: true
    }
    
  return c.json(response, 202)
    
  } catch (error) {
    console.error('Error processing page translation files:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process page translation files'
    }
    return c.json(errorResponse, 500)
  }
})

pageTranslationRoutes.post('/trigger', async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({})) as Record<string, unknown> | null
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

    const result = await triggerPageTranslation({ senderId, locale })

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
      savedFiles: result.savedFiles,
      translationPending: true
    }

    return c.json(response)
  } catch (error) {
    console.error('Error triggering page translation:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger page translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default pageTranslationRoutes