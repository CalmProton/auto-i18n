/**
 * Dashboard API Routes
 * RESTful endpoints for the dashboard UI
 */

import { Elysia, t } from 'elysia'
import { createScopedLogger } from '../utils/logger'
import {
  listAllUploads,
  getUploadInfo,
  listAllBatches,
  getBatchInfo,
  listAllTranslationSessions,
  getTranslationStatus,
  listReadyForGitHub,
  getSystemStats,
  deleteUploadSession,
  deleteBatch,
  listFiles,
} from '../utils/dashboardUtils'
import { SUPPORTED_LOCALES } from '../config/locales'
import type { Upload, Batch, TranslationSession, GitHubSession } from '../types/api'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const log = createScopedLogger('routes:dashboard')
const TMP_DIR = join(process.cwd(), 'tmp')

const dashboardRoutes = new Elysia({ prefix: '/api' })

// ==================== UPLOADS ====================

/**
 * GET /api/uploads
 * List all upload sessions
 */
dashboardRoutes.get(
  '/uploads',
  async ({ query }) => {
    try {
      const { status, limit = 50, offset = 0 } = query
      let uploads = listAllUploads()

      // Filter by status if provided
      if (status && status !== 'all') {
        uploads = uploads.filter((u) => u.status === status)
      }

      // Sort by most recent first
      uploads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

      // Apply pagination
      const total = uploads.length
      const paginatedUploads = uploads.slice(Number(offset), Number(offset) + Number(limit))

      return {
        uploads: paginatedUploads,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + Number(limit) < total,
        },
      }
    } catch (error) {
      log.error('Error listing uploads:', error)
      return { error: 'Failed to list uploads', uploads: [] }
    }
  },
  {
    query: t.Object({
      status: t.Optional(t.Union([t.Literal('all'), t.Literal('uploaded'), t.Literal('batched'), t.Literal('translating'), t.Literal('completed')])),
      limit: t.Optional(t.Numeric({ default: 50 })),
      offset: t.Optional(t.Numeric({ default: 0 })),
    }),
  }
)

/**
 * GET /api/uploads/:senderId
 * Get detailed information about a specific upload
 */
dashboardRoutes.get('/uploads/:senderId', async ({ params }) => {
  try {
    const { senderId } = params
    const uploadInfo = getUploadInfo(senderId)

    if (!uploadInfo) {
      return { error: 'Upload not found' }
    }

    // Get files for each type
    const uploadsDir = join(TMP_DIR, senderId, 'uploads', uploadInfo.sourceLocale)
    const files: Record<string, Array<{ name: string; size: number; path: string }>> = {
      content: listFiles(join(uploadsDir, 'content')),
      global: listFiles(join(uploadsDir, 'global')),
      page: listFiles(join(uploadsDir, 'page')),
    }

    // Get associated batches
    const batchesDir = join(TMP_DIR, senderId, 'batches')
    const batches = uploadInfo.batchIds?.map((batchId) => getBatchInfo(senderId, batchId)).filter(Boolean) || []

    // Get translation status
    const translations = getTranslationStatus(senderId)

    return {
      upload: uploadInfo,
      files,
      batches,
      translations,
    }
  } catch (error) {
    log.error(`Error getting upload ${params.senderId}:`, error)
    return { error: 'Failed to get upload details' }
  }
})

/**
 * POST /api/uploads/:senderId/trigger
 * Trigger translation for uploaded files
 */
dashboardRoutes.post('/uploads/:senderId/trigger', async ({ params, body }) => {
  try {
    const { senderId } = params
    const { types, targetLocales, model, provider, jobType } = body as {
      types?: ('content' | 'global' | 'page')[]
      targetLocales?: string[]
      model?: string
      provider?: 'openai' | 'anthropic' | 'deepseek'
      jobType?: 'openai-batch' | 'regular-translation'
    }

    // This endpoint will trigger translation based on the job type
    // For now, return a placeholder - implementation will follow
    return {
      success: true,
      message: 'Translation triggered successfully',
      senderId,
      jobType: jobType || 'regular-translation',
      targetLocales,
      types,
      model,
      provider,
    }
  } catch (error) {
    log.error(`Error triggering translation for ${params.senderId}:`, error)
    return { error: 'Failed to trigger translation' }
  }
})

/**
 * DELETE /api/uploads/:senderId
 * Delete an upload session and all associated data
 */
dashboardRoutes.delete('/uploads/:senderId', async ({ params }) => {
  try {
    const { senderId } = params
    deleteUploadSession(senderId)
    return { success: true, message: 'Upload session deleted' }
  } catch (error) {
    log.error(`Error deleting upload ${params.senderId}:`, error)
    return { error: 'Failed to delete upload session' }
  }
})

// ==================== BATCHES ====================

/**
 * GET /api/batches
 * List all batches
 */
dashboardRoutes.get(
  '/batches',
  async ({ query }) => {
    try {
      const { status, senderId, limit = 50, offset = 0 } = query
      let batches = listAllBatches()

      // Filter by status if provided
      if (status && status !== 'all') {
        batches = batches.filter((b) => b.status === status)
      }

      // Filter by senderId if provided
      if (senderId) {
        batches = batches.filter((b) => b.senderId === senderId)
      }

      // Sort by most recent first
      batches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      // Apply pagination
      const total = batches.length
      const paginatedBatches = batches.slice(Number(offset), Number(offset) + Number(limit))

      return {
        batches: paginatedBatches,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + Number(limit) < total,
        },
      }
    } catch (error) {
      log.error('Error listing batches:', error)
      return { error: 'Failed to list batches', batches: [] }
    }
  },
  {
    query: t.Object({
      status: t.Optional(
        t.Union([
          t.Literal('all'),
          t.Literal('pending'),
          t.Literal('submitted'),
          t.Literal('processing'),
          t.Literal('completed'),
          t.Literal('failed'),
          t.Literal('cancelled'),
          t.Literal('partially_failed'),
        ])
      ),
      senderId: t.Optional(t.String()),
      limit: t.Optional(t.Numeric({ default: 50 })),
      offset: t.Optional(t.Numeric({ default: 0 })),
    }),
  }
)

/**
 * GET /api/batches/:batchId
 * Get detailed information about a specific batch
 */
dashboardRoutes.get('/batches/:senderId/:batchId', async ({ params }) => {
  try {
    const { senderId, batchId } = params
    const batchInfo = getBatchInfo(senderId, batchId)

    if (!batchInfo) {
      return { error: 'Batch not found' }
    }

    const batchDir = join(TMP_DIR, senderId, 'batches', batchId)

    // Check for files
    const files = {
      input: { exists: existsSync(join(batchDir, 'batch_input.jsonl')), path: 'batch_input.jsonl' },
      output: { exists: existsSync(join(batchDir, 'batch_output.jsonl')), path: 'batch_output.jsonl' },
      manifest: { exists: existsSync(join(batchDir, 'manifest.json')), path: 'manifest.json' },
      error: {
        exists: batchInfo.hasErrors,
        path: `batch_${batchInfo.openAiBatchId}_error.jsonl`,
        errorCount: batchInfo.errorCount,
      },
    }

    return {
      batch: batchInfo,
      files,
    }
  } catch (error) {
    log.error(`Error getting batch ${params.senderId}/${params.batchId}:`, error)
    return { error: 'Failed to get batch details' }
  }
})

/**
 * POST /api/batches/:senderId/:batchId/process
 * Process a completed batch output
 */
dashboardRoutes.post('/batches/:senderId/:batchId/process', async ({ params, body }) => {
  try {
    const { senderId, batchId } = params
    const { batchOutputId } = body as { batchOutputId: string }

    // Forward to the existing batch processing endpoint logic
    // For now, return a placeholder - this will be implemented with the actual batch output processor
    return {
      success: true,
      message: 'Batch processing endpoint - implementation pending',
      senderId,
      batchId,
      batchOutputId,
    }
  } catch (error) {
    log.error(`Error processing batch ${params.senderId}/${params.batchId}:`, error)
    return { error: 'Failed to process batch output' }
  }
})

/**
 * POST /api/batches/:senderId/:batchId/retry
 * Create a retry batch from failed requests
 */
dashboardRoutes.post('/batches/:senderId/:batchId/retry', async ({ params, body }) => {
  try {
    const { senderId, batchId } = params
    const { errorFileName, model } = body as { errorFileName?: string; model?: string }

    // Get batch info to find the error file name if not provided
    const batchInfo = getBatchInfo(senderId, batchId)
    if (!batchInfo) {
      return { error: 'Batch not found' }
    }

    const actualErrorFileName = errorFileName || batchInfo.errorFileName
    if (!actualErrorFileName) {
      return { error: 'No error file found for this batch' }
    }

    // Import the createRetryBatch function
    const { createRetryBatch } = await import('../services/translation/openaiBatchService')

    const result = await createRetryBatch({
      senderId,
      originalBatchId: batchId,
      errorFileName: actualErrorFileName,
      model,
    })

    return {
      success: true,
      message: 'Retry batch created successfully',
      batchId: result.batchId,
      originalBatchId: batchId,
      requestCount: result.requestCount,
      failedRequestCount: result.failedRequestCount,
      model: result.manifest.model,
    }
  } catch (error) {
    log.error(`Error creating retry batch for ${params.senderId}/${params.batchId}:`, error)
    const message = error instanceof Error ? error.message : 'Failed to create retry batch'
    return { error: message }
  }
})

/**
 * DELETE /api/batches/:senderId/:batchId
 * Delete a batch
 */
dashboardRoutes.delete('/batches/:senderId/:batchId', async ({ params }) => {
  try {
    const { senderId, batchId } = params
    deleteBatch(senderId, batchId)
    return { success: true, message: 'Batch deleted' }
  } catch (error) {
    log.error(`Error deleting batch ${params.senderId}/${params.batchId}:`, error)
    return { error: 'Failed to delete batch' }
  }
})

// ==================== TRANSLATIONS ====================

/**
 * GET /api/translations
 * List all translation sessions
 */
dashboardRoutes.get(
  '/translations',
  async ({ query }) => {
    try {
      const { senderId, limit = 50, offset = 0 } = query
      let translations = listAllTranslationSessions()

      // Filter by senderId if provided
      if (senderId) {
        translations = translations.filter((t) => t.senderId === senderId)
      }

      // Sort by most recent first
      translations.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

      // Apply pagination
      const total = translations.length
      const paginatedTranslations = translations.slice(Number(offset), Number(offset) + Number(limit))

      return {
        translations: paginatedTranslations,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + Number(limit) < total,
        },
      }
    } catch (error) {
      log.error('Error listing translations:', error)
      return { error: 'Failed to list translations', translations: [] }
    }
  },
  {
    query: t.Object({
      senderId: t.Optional(t.String()),
      limit: t.Optional(t.Numeric({ default: 50 })),
      offset: t.Optional(t.Numeric({ default: 0 })),
    }),
  }
)

/**
 * GET /api/translations/:senderId/status
 * Get translation status matrix for a sender
 */
dashboardRoutes.get('/translations/:senderId/status', async ({ params }) => {
  try {
    const { senderId } = params
    const status = getTranslationStatus(senderId)

    if (!status) {
      return { error: 'Translation status not found' }
    }

    return status
  } catch (error) {
    log.error(`Error getting translation status for ${params.senderId}:`, error)
    return { error: 'Failed to get translation status' }
  }
})

/**
 * GET /api/translations/:senderId/:locale/:type
 * Get translation files for a specific locale and type
 */
dashboardRoutes.get('/translations/:senderId/:locale/:type', async ({ params }) => {
  try {
    const { senderId, locale, type } = params
    const translationsDir = join(TMP_DIR, senderId, 'translations', locale, type)

    if (!existsSync(translationsDir)) {
      return { error: 'Translation files not found', files: [] }
    }

    const files = listFiles(translationsDir)

    return {
      senderId,
      locale,
      type,
      files,
    }
  } catch (error) {
    log.error(`Error getting translation files for ${params.senderId}/${params.locale}/${params.type}:`, error)
    return { error: 'Failed to get translation files' }
  }
})

// ==================== GITHUB ====================

/**
 * GET /api/github/ready
 * List upload sessions ready for GitHub PR
 */
dashboardRoutes.get('/github/ready', async () => {
  try {
    const sessions = listReadyForGitHub()
    return { sessions }
  } catch (error) {
    log.error('Error listing GitHub ready sessions:', error)
    return { error: 'Failed to list GitHub ready sessions', sessions: [] }
  }
})

/**
 * GET /api/github/status/:senderId
 * Check GitHub PR status for a sender
 */
dashboardRoutes.get('/github/status/:senderId', async ({ params }) => {
  try {
    const { senderId } = params
    const metadataPath = join(TMP_DIR, senderId, 'metadata.json')
    
    if (!existsSync(metadataPath)) {
      return {
        hasPR: false,
      }
    }

    // Read metadata to check for PR info
    // For now, return a placeholder
    return {
      hasPR: false,
      message: 'GitHub status check - implementation pending',
    }
  } catch (error) {
    log.error(`Error checking GitHub status for ${params.senderId}:`, error)
    return { error: 'Failed to check GitHub status' }
  }
})

// ==================== SYSTEM ====================

/**
 * GET /api/system/stats
 * Get system statistics
 */
dashboardRoutes.get('/system/stats', async () => {
  try {
    const stats = getSystemStats()
    return stats
  } catch (error) {
    log.error('Error getting system stats:', error)
    return { error: 'Failed to get system stats' }
  }
})

/**
 * GET /api/locales
 * Get supported locales
 */
dashboardRoutes.get('/api/locales', async () => {
  return {
    locales: SUPPORTED_LOCALES,
    default: 'en',
  }
})

export default dashboardRoutes
