import { Elysia } from 'elysia'
import { processContentFiles, triggerContentTranslation } from '../services/fileProcessor'
import { extractLocale, extractSenderId, parseContentUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'
import { isSupportedLocale } from '../config/locales'
import { createScopedLogger } from '../utils/logger'
import { extractMetadataUpdate } from '../utils/metadataInput'
import { updateMetadata } from '../utils/jobMetadata'

const contentRoutes = new Elysia({ prefix: '/translate/content' })
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
contentRoutes.post('/', async ({ body, query, request, set }) => {
  const requestUrl = new URL(request.url)
  const requestSnapshot: Record<string, unknown> = {
    method: request.method,
    url: request.url,
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    headers: sanitizeHeaders(request.headers)
  }
  let requestBody: Record<string, unknown> | undefined
  try {
    const formData = await request.formData()
    const parsedBody: Record<string, unknown> = {}
    for (const [key, value] of formData.entries()) {
      parsedBody[key] = value
    }
    requestBody = parsedBody
    requestSnapshot.body = serializeRequestBody(parsedBody)
    
    // Extract locale and sender from query or body
    const locale = query.locale || extractLocale(parsedBody)
    const senderId = query.senderId || extractSenderId(parsedBody)
    log.info('Received content upload request', {
      locale,
      senderId,
      bodyKeys: Object.keys(parsedBody ?? {}).filter((key) => key !== 'locale' && key !== 'senderId')
    })
    requestSnapshot.locale = locale
    requestSnapshot.senderId = senderId
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
    
    // Parse and validate content upload request
    const contentRequest = parseContentUpload(parsedBody, locale, senderId)
    if (typeof contentRequest === 'string') {
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: contentRequest
      }
      log.warn('Content upload validation failed', {
        locale,
        senderId,
        reason: contentRequest
      })
      return errorResponse
    }
    
    const metadataRaw = parsedBody.metadata ?? query.metadata
    const jobId = typeof parsedBody.jobId === 'string' ? parsedBody.jobId.trim() : 'content'

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
      set.status = 400
      const errorResponse: ErrorResponse = {
        error: metadataResult.error
      }
      log.warn('Content metadata extraction failed', {
        senderId,
        locale,
        reason: metadataResult.error
      })
      return errorResponse
    }

    // Process the files
    log.info('Processing content upload', {
      senderId: contentRequest.senderId,
      locale: contentRequest.locale,
      fileCount: contentRequest.files.length
    })

    const result = await processContentFiles(contentRequest)
    
    if (!result.success) {
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      log.error('Content upload processing failed', {
        senderId: contentRequest.senderId,
        locale: contentRequest.locale,
        message: result.message,
        request: requestSnapshot
      })
      return errorResponse
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
      set.status = 500
      const errorResponse: ErrorResponse = {
        error: 'Failed to persist metadata for content upload'
      }
      return errorResponse
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
    
    set.status = 202
    return response
    
  } catch (error) {
    if (requestBody && !requestSnapshot.body) {
      requestSnapshot.body = serializeRequestBody(requestBody)
    }
    log.error('Error processing content files', {
      error,
      request: requestSnapshot
    })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to process content files'
    }
    return errorResponse
  }
})

contentRoutes.post('/trigger', async ({ body, query, set }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const locale = query.locale || (typeof payload.locale === 'string' ? payload.locale : null)
    const senderId = query.senderId || (typeof payload.senderId === 'string' ? payload.senderId : null)

    log.info('Received content translation trigger', {
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

    set.status = 202
    return response
  } catch (error) {
    log.error('Error triggering content translation', { error })
    set.status = 500
    const errorResponse: ErrorResponse = {
      error: 'Failed to trigger content translation'
    }
    return errorResponse
  }
})

export default contentRoutes