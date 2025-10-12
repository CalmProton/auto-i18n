import { Elysia } from 'elysia'
import { processGlobalTranslation, triggerGlobalTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseGlobalUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'
import { extractMetadataUpdate } from '../utils/metadataInput'
import { updateMetadata } from '../utils/jobMetadata'

const globalTranslationRoutes = new Elysia({ prefix: '/translate/global' })
const log = createScopedLogger('routes:global')

// Upload endpoint for global translation file
// Structure: [locale].json
globalTranslationRoutes.post('/', async ({ query, request, set }) => {
  try {
    const formData = await request.formData()
    const parsedBody: Record<string, unknown> = {}
    for (const [key, value] of formData.entries()) {
      parsedBody[key] = value
    }
    
    // Extract locale and sender from query or body
    const locale = query.locale || extractLocale(parsedBody)
    const senderId = query.senderId || extractSenderId(parsedBody)
    log.info('Received global translation upload', {
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
    
    // Parse and validate global upload request
  const globalRequest = parseGlobalUpload(parsedBody, locale, senderId)
    if (typeof globalRequest === 'string') {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: globalRequest
      }
      log.warn('Global translation upload validation failed', {
        locale,
        senderId,
        reason: globalRequest
      })
      return errorResponse
    }
    
    const metadataRaw = parsedBody.metadata ?? query.metadata
    const fallbackRepoPath = typeof parsedBody.repositorySourcePath === 'string' ? parsedBody.repositorySourcePath.trim() : undefined
    const jobId = typeof parsedBody.jobId === 'string' ? parsedBody.jobId.trim() : 'global'

    const metadataResult = extractMetadataUpdate({
      rawMetadata: metadataRaw,
      fallbackRepositorySourcePath: fallbackRepoPath,
      defaultJobId: jobId || 'global',
      jobType: 'global',
      sourceLocale: globalRequest.locale,
      actualFiles: [
        {
          sourceTempRelativePath: globalRequest.file.name,
          repositorySourcePath: fallbackRepoPath
        }
      ]
    })

    if ('error' in metadataResult) {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: metadataResult.error
      }
      log.warn('Global metadata extraction failed', {
        senderId,
        locale,
        reason: metadataResult.error
      })
      return errorResponse
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
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Global translation upload failed', {
        senderId: globalRequest.senderId,
        locale: globalRequest.locale,
        message: result.message
      })
      return errorResponse
    }
    
    try {
      await updateMetadata(senderId, metadataResult.update)
    } catch (error) {
      log.error('Failed to persist metadata for global upload', {
        senderId,
        locale,
        error
      })
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: 'Failed to persist metadata for global upload'
      }
      return errorResponse
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
    
    set.status = 202
    return response
    
  } catch (error) {
    log.error('Error processing global translation file', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to process global translation file'
    }
    return errorResponse
  }
})

globalTranslationRoutes.post('/trigger', async ({ body, query, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const locale = query.locale || (typeof payload.locale === 'string' ? payload.locale : null)
    const senderId = query.senderId || (typeof payload.senderId === 'string' ? payload.senderId : null)

    log.info('Received global translation trigger', {
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

    return response
  } catch (error) {
    log.error('Error triggering global translation', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger global translation'
    }
    return errorResponse
  }
})

export default globalTranslationRoutes