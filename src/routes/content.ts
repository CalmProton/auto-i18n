import { Hono } from 'hono'
import { processContentFiles, triggerContentTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseContentUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'
import { extractMetadataUpdate } from '../utils/metadataInput'
import { updateMetadata } from '../utils/jobMetadata'

const contentRoutes = new Hono()
const log = createScopedLogger('routes:content')

// Upload endpoint for content files
// Structure: content/[locale]/[folder_name]/[files].md
contentRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    // Extract locale and sender from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    const senderId = c.req.query('senderId') || extractSenderId(body)
    log.info('Received content upload request', {
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
    
    // Parse and validate content upload request
    const contentRequest = parseContentUpload(body, locale, senderId)
    if (typeof contentRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: contentRequest
      }
      log.warn('Content upload validation failed', {
        locale,
        senderId,
        reason: contentRequest
      })
      return c.json(errorResponse, 400)
    }
    
    const metadataRaw = body.metadata ?? c.req.query('metadata')
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : 'content'

    const metadataResult = extractMetadataUpdate({
      rawMetadata: metadataRaw,
      defaultJobId: jobId || 'content',
      jobType: 'content',
      sourceLocale: contentRequest.locale,
      actualFiles: contentRequest.files.map(({ relativePath, file, folderPath }) => ({
        sourceTempRelativePath: relativePath,
        label: folderPath ? `${folderPath}/${file.name}` : file.name
      }))
    })

    if ('error' in metadataResult) {
      const errorResponse: ErrorResponse = {
        error: metadataResult.error
      }
      log.warn('Content metadata extraction failed', {
        senderId,
        locale,
        reason: metadataResult.error
      })
      return c.json(errorResponse, 400)
    }

    // Process the files
    log.info('Processing content upload', {
      senderId: contentRequest.senderId,
      locale: contentRequest.locale,
      fileCount: contentRequest.files.length
    })

    const result = await processContentFiles(contentRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Content upload processing failed', {
        senderId: contentRequest.senderId,
        locale: contentRequest.locale,
        message: result.message
      })
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
    
    try {
      await updateMetadata(senderId, metadataResult.update)
    } catch (error) {
      log.error('Failed to persist metadata for content upload', {
        senderId,
        locale,
        error
      })
      const errorResponse: ErrorResponse = {
        error: 'Failed to persist metadata for content upload'
      }
      return c.json(errorResponse, 500)
    }

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

    log.info('Content upload processed successfully', {
      senderId: result.senderId,
      locale: contentRequest.locale,
      filesProcessed: contentRequest.files.length,
      folders: folderSummary
    })
    
  return c.json(response, 202)
    
  } catch (error) {
    log.error('Error processing content files', { error })
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

    log.info('Received content translation trigger', {
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

    const result = await triggerContentTranslation({ senderId, locale })

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Content translation trigger failed', {
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
      folders: result.folderSummary,
      savedFiles: result.savedFiles,
      translationPending: true
    }

    log.info('Content translation trigger accepted', {
      senderId: result.senderId,
      locale: result.locale,
      filesProcessed: result.processedCount,
      folders: result.folderSummary
    })

    return c.json(response, 202)
  } catch (error) {
    log.error('Error triggering content translation', { error })
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger content translation'
    }
    return c.json(errorResponse, 500)
  }
})

export default contentRoutes