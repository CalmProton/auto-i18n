import { Elysia } from 'elysia'
import { processPageTranslations, triggerPageTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parsePageUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'
import { extractMetadataUpdate } from '../utils/metadataInput'
import { updateMetadata } from '../utils/jobMetadata'

const pageTranslationRoutes = new Elysia({ prefix: '/translate/page' })
const log = createScopedLogger('routes:page')

// Upload endpoint for page translation files
// Structure: multiple folders, each containing [locale].json
pageTranslationRoutes.post('/', async ({ query, request, set }) => {
  try {
    const formData = await request.formData()
    const parsedBody: Record<string, unknown> = {}
    for (const [key, value] of formData.entries()) {
      parsedBody[key] = value
    }
    
    // Extract locale and sender from query or body
    const locale = query.locale || extractLocale(parsedBody)
    const senderId = query.senderId || extractSenderId(parsedBody)
    log.info('Received page translation upload', {
      locale,
      senderId,
      bodyKeys: Object.keys(parsedBody ?? {}).filter((key) => key !== 'locale' && key !== 'senderId')
    })
    if (!locale) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: 'Locale parameter is required'
      }
      return errorResponse
    }
    if (!isSupportedLocale(locale)) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: `Locale "${locale}" is not supported`
      }
      return errorResponse
    }
    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: 'Sender identifier is required'
      }
      return errorResponse
    }
    
    // Parse and validate page upload request
  const pageRequest = parsePageUpload(parsedBody, locale, senderId)
    if (typeof pageRequest === 'string') {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: pageRequest
      }
      log.warn('Page translation upload validation failed', {
        locale,
        senderId,
        reason: pageRequest
      })
      return errorResponse
    }
    
    const metadataRaw = parsedBody.metadata ?? query.metadata
    const jobId = typeof parsedBody.jobId === 'string' ? parsedBody.jobId.trim() : 'page'

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
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: metadataResult.error
      }
      log.warn('Page metadata extraction failed', {
        senderId,
        locale,
        reason: metadataResult.error
      })
      return errorResponse
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
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Page translation upload failed', {
        senderId: pageRequest.senderId,
        locale: pageRequest.locale,
        message: result.message
      })
      return errorResponse
    }
    
    try {
      await updateMetadata(senderId, metadataResult.update)
    } catch (error) {
      log.error('Failed to persist metadata for page upload', {
        senderId,
        locale,
        error
      })
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: 'Failed to persist metadata for page upload'
      }
      return errorResponse
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
    
    set.status = 202
    return response
    
  } catch (error) {
    log.error('Error processing page translation files', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to process page translation files'
    }
    return errorResponse
  }
})

pageTranslationRoutes.post('/trigger', async ({ body, query, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const locale = query.locale || (typeof payload.locale === 'string' ? payload.locale : null)
    const senderId = query.senderId || (typeof payload.senderId === 'string' ? payload.senderId : null)

    log.info('Received page translation trigger', {
      locale,
      senderId
    })

    if (!locale) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: 'Locale parameter is required'
      }
      return errorResponse
    }
    if (!isSupportedLocale(locale)) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: `Locale "${locale}" is not supported`
      }
      return errorResponse
    }
    if (!senderId) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: 'Sender identifier is required'
      }
      return errorResponse
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
        set.status = 404
        return errorResponse
      }
      if (result.statusCode === 400) {
        set.status = 400
        return errorResponse
      }
      set.status = 500
      return errorResponse
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

    return response
  } catch (error) {
    log.error('Error triggering page translation', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger page translation'
    }
    return errorResponse
  }
})

export default pageTranslationRoutes