import { Hono } from 'hono'
import { processGlobalTranslation, triggerGlobalTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseGlobalUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'

const globalTranslationRoutes = new Hono()

// Upload endpoint for global translation file
// Structure: [locale].json
globalTranslationRoutes.post('/', async (c) => {
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
    
    // Parse and validate global upload request
  const globalRequest = parseGlobalUpload(body, locale, senderId)
    if (typeof globalRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: globalRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the file
    const result = await processGlobalTranslation(globalRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }
    
    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: globalRequest.locale,
      file: { name: globalRequest.file.name, size: globalRequest.file.size },
      savedFiles: result.savedFiles,
      translatedFiles: result.translatedFiles,
      translationPending: true
    }
    
  return c.json(response, 202)
    
  } catch (error) {
    console.error('Error processing global translation file:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process global translation file'
    }
    return c.json(errorResponse, 500)
  }
})

globalTranslationRoutes.post('/trigger', async (c) => {
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

    const result = await triggerGlobalTranslation({ senderId, locale })

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

    const baseFile = result.savedFiles && result.savedFiles[0]

    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      savedFiles: result.savedFiles,
      translationPending: true,
      file: baseFile ? { name: baseFile.name, size: baseFile.size } : undefined
    }

    return c.json(response)
  } catch (error) {
    console.error('Error triggering global translation:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger global translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default globalTranslationRoutes