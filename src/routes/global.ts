import { Hono } from 'hono'
import { processGlobalTranslation, triggerGlobalTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseGlobalUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'

const globalTranslationRoutes = new Hono()
const log = createScopedLogger('routes:global')

// Upload endpoint for global translation file
// Structure: [locale].json
globalTranslationRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    // Extract locale and sender from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    const senderId = c.req.query('senderId') || extractSenderId(body)
    log.info('Received global translation upload', {
      locale,
      senderId,
      bodyKeys: Object.keys(body ?? {}).filter((key) => key !== 'locale' && key !== 'senderId')
    })
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
      log.warn('Global translation upload validation failed', {
        locale,
        senderId,
        reason: globalRequest
      })
      return c.json(errorResponse, 400)
    }
    
    // Process the file
    log.info('Processing global translation upload', {
      senderId: globalRequest.senderId,
      locale: globalRequest.locale,
      fileName: globalRequest.file.name,
      fileSize: globalRequest.file.size
    })

    const result = await processGlobalTranslation(globalRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Global translation upload failed', {
        senderId: globalRequest.senderId,
        locale: globalRequest.locale,
        message: result.message
      })
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

    log.info('Global translation upload stored successfully', {
      senderId: result.senderId,
      locale: globalRequest.locale,
      savedFiles: result.savedFiles?.map((file) => ({
        name: file.name,
        path: file.path
      }))
    })
    
  return c.json(response, 202)
    
  } catch (error) {
    log.error('Error processing global translation file', { error })
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

    log.info('Received global translation trigger', {
      locale,
      senderId
    })

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
      log.error('Global translation trigger failed', {
        senderId,
        locale,
        statusCode: result.statusCode ?? 500,
        message: result.message
      })
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

    log.info('Global translation trigger accepted', {
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      savedFiles: result.savedFiles
    })

    return c.json(response)
  } catch (error) {
    log.error('Error triggering global translation', { error })
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger global translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default globalTranslationRoutes