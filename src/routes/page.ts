import { Hono } from 'hono'
import { processPageTranslations, triggerPageTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parsePageUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'
import { extractMetadataUpdate } from '../utils/metadataInput'
import { updateMetadata } from '../utils/jobMetadata'

const pageTranslationRoutes = new Hono()
const log = createScopedLogger('routes:page')

// Upload endpoint for page translation files
// Structure: multiple folders, each containing [locale].json
pageTranslationRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    // Extract locale and sender from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    const senderId = c.req.query('senderId') || extractSenderId(body)
    log.info('Received page translation upload', {
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
    
    // Parse and validate page upload request
  const pageRequest = parsePageUpload(body, locale, senderId)
    if (typeof pageRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: pageRequest
      }
      log.warn('Page translation upload validation failed', {
        locale,
        senderId,
        reason: pageRequest
      })
      return c.json(errorResponse, 400)
    }
    
    const metadataRaw = body.metadata ?? c.req.query('metadata')
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : 'page'

    const metadataResult = extractMetadataUpdate({
      rawMetadata: metadataRaw,
      defaultJobId: jobId || 'page',
      jobType: 'page',
      sourceLocale: pageRequest.locale,
      actualFiles: pageRequest.folders.map(({ folderName }) => ({
        sourceTempRelativePath: folderName ? `${folderName}/${pageRequest.locale}.json` : `${pageRequest.locale}.json`,
        label: folderName || undefined
      }))
    })

    if ('error' in metadataResult) {
      const errorResponse: ErrorResponse = {
        error: metadataResult.error
      }
      log.warn('Page metadata extraction failed', {
        senderId,
        locale,
        reason: metadataResult.error
      })
      return c.json(errorResponse, 400)
    }

    // Process the files
    log.info('Processing page translation upload', {
      senderId: pageRequest.senderId,
      locale: pageRequest.locale,
      folderCount: pageRequest.folders.length,
      folderNames: pageRequest.folders.map(folder => folder.folderName)
    })

    const result = await processPageTranslations(pageRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Page translation upload failed', {
        senderId: pageRequest.senderId,
        locale: pageRequest.locale,
        message: result.message
      })
      return c.json(errorResponse, 500)
    }
    
    try {
      await updateMetadata(senderId, metadataResult.update)
    } catch (error) {
      log.error('Failed to persist metadata for page upload', {
        senderId,
        locale,
        error
      })
      const errorResponse: ErrorResponse = {
        error: 'Failed to persist metadata for page upload'
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

    log.info('Page translation upload stored successfully', {
      senderId: result.senderId,
      locale: pageRequest.locale,
      filesProcessed: pageRequest.folders.length,
      folders: pageRequest.folders.map((f) => f.folderName)
    })
    
  return c.json(response, 202)
    
  } catch (error) {
    log.error('Error processing page translation files', { error })
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

    log.info('Received page translation trigger', {
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

    const result = await triggerPageTranslation({ senderId, locale })

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Page translation trigger failed', {
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

    const response: FileUploadResponse = {
      message: result.message,
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      savedFiles: result.savedFiles,
      translationPending: true
    }

    log.info('Page translation trigger accepted', {
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      savedFiles: result.savedFiles
    })

    return c.json(response)
  } catch (error) {
    log.error('Error triggering page translation', { error })
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger page translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default pageTranslationRoutes