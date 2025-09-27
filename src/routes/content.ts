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

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-api-key'])

function maskSensitiveHeader(value: string): string {
  if (!value) {
    return value
  }
  if (value.length <= 6) {
    return '***'
  }
  return `${value.slice(0, 6)}… [masked]`
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    sanitized[key] = SENSITIVE_HEADER_NAMES.has(lowerKey)
      ? maskSensitiveHeader(value)
      : value
  })
  return sanitized
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function serializeRequestBodyValue(value: unknown): unknown {
  if (value instanceof File) {
    return {
      kind: 'file',
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified
    }
  }
  if (value instanceof Blob) {
    return {
      kind: 'blob',
      size: value.size,
      type: value.type
    }
  }
  if (value instanceof Uint8Array) {
    return {
      kind: 'Uint8Array',
      length: value.length
    }
  }
  if (value instanceof ArrayBuffer) {
    return {
      kind: 'ArrayBuffer',
      byteLength: value.byteLength
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeRequestBodyValue(entry))
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeRequestBodyValue(entry)])
    )
  }
  return value ?? null
}

function serializeRequestBody(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, serializeRequestBodyValue(value)])
  )
}

// Upload endpoint for content files
// Structure: content/[locale]/[folder_name]/[files].md
contentRoutes.post('/', async (c) => {
  const requestUrl = new URL(c.req.url)
  const requestSnapshot: Record<string, unknown> = {
    method: c.req.method,
    url: c.req.url,
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    headers: sanitizeHeaders(c.req.raw.headers)
  }
  let requestBody: Record<string, unknown> | undefined
  try {
    const body = (await c.req.parseBody()) as Record<string, unknown>
    requestBody = body
    requestSnapshot.body = serializeRequestBody(body)
    
    // Extract locale and sender from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    const senderId = c.req.query('senderId') || extractSenderId(body)
    log.info('Received content upload request', {
      locale,
      senderId,
      bodyKeys: Object.keys(body ?? {}).filter((key) => key !== 'locale' && key !== 'senderId')
    })
    requestSnapshot.locale = locale
    requestSnapshot.senderId = senderId
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
        message: result.message,
        request: requestSnapshot
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
        error,
        request: requestSnapshot
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
    if (requestBody && !requestSnapshot.body) {
      requestSnapshot.body = serializeRequestBody(requestBody)
    }
    log.error('Error processing content files', {
      error,
      request: requestSnapshot
    })
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