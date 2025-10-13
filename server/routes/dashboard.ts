/**
 * Dashboard API Routes
 * RESTful endpoints for the dashboard UI
 */

import { Elysia, t } from 'elysia'
import { readFileSync } from 'fs'
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
  getDashboardOverview,
  deleteUploadSession,
  deleteBatch,
  listFiles,
} from '../utils/dashboardUtils'
import { SUPPORTED_LOCALES } from '../config/locales'
import type { Upload, Batch, TranslationSession, GitHubSession } from '../types/api'
import { join, sep } from 'node:path'
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

    // Determine if this is a change session or regular upload
    const changesOriginalDir = join(TMP_DIR, senderId, 'changes', 'original')
    const isChangeSession = existsSync(changesOriginalDir)
    
    let files: Record<string, Array<{ name: string; size: number; path: string }>>
    
    if (isChangeSession) {
      // For changes, files are directly in changes/original/
      const allFiles = listFiles(changesOriginalDir)
      
      // Categorize files based on extension and location
      // JSON files at root level are global, in subdirectories are page
      const changesOriginalDepth = changesOriginalDir.split(sep).length
      
      files = {
        content: allFiles.filter(f => f.name.endsWith('.md') || f.name.endsWith('.mdx')),
        global: allFiles.filter(f => {
          if (!f.name.endsWith('.json')) return false
          // Global files are JSON files directly in the root (not in subdirectories)
          const fileDepth = f.path.split(sep).length
          return fileDepth === changesOriginalDepth + 1
        }),
        page: allFiles.filter(f => {
          if (!f.name.endsWith('.json')) return false
          // Page files are JSON files in subdirectories
          const fileDepth = f.path.split(sep).length
          return fileDepth > changesOriginalDepth + 1
        }),
      }
    } else {
      // For regular uploads, files are organized by type in uploads/{locale}/
      const uploadsDir = join(TMP_DIR, senderId, 'uploads', uploadInfo.sourceLocale)
      files = {
        content: listFiles(join(uploadsDir, 'content')),
        global: listFiles(join(uploadsDir, 'global')),
        page: listFiles(join(uploadsDir, 'page')),
      }
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

    // Parse unique errors if error file exists
    let uniqueErrors: Array<{ code: string; type: string; message: string; count: number }> = []
    if (batchInfo.hasErrors && batchInfo.errorFileName) {
      try {
        const errorPath = join(batchDir, batchInfo.errorFileName)
        const errorContent = readFileSync(errorPath, 'utf-8')
        const errorLines = errorContent.split('\n').filter((l: string) => l.trim())
        
        // Group errors by code and type
        const errorMap = new Map<string, { code: string; type: string; message: string; count: number }>()
        
        for (const line of errorLines) {
          try {
            const errorEntry = JSON.parse(line)
            const errorData = errorEntry.response?.body?.error
            
            if (errorData) {
              const key = `${errorData.code || 'unknown'}_${errorData.type || 'unknown'}`
              
              if (errorMap.has(key)) {
                errorMap.get(key)!.count++
              } else {
                errorMap.set(key, {
                  code: errorData.code || 'unknown',
                  type: errorData.type || 'unknown',
                  message: errorData.message || 'Unknown error',
                  count: 1,
                })
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
        
        uniqueErrors = Array.from(errorMap.values()).sort((a, b) => b.count - a.count)
      } catch (error) {
        log.error(`Error parsing error file for ${senderId}/${batchId}:`, error)
      }
    }

    return {
      batch: batchInfo,
      files,
      uniqueErrors,
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
 * GET /api/stats
 * Get dashboard overview statistics
 */
dashboardRoutes.get('/stats', async () => {
  try {
    const stats = getDashboardOverview()
    return stats
  } catch (error) {
    log.error('Error getting dashboard overview:', error)
    return { error: 'Failed to get dashboard overview' }
  }
})

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

// ==================== CHANGES ====================

/**
 * GET /api/changes
 * List all change sessions
 */
dashboardRoutes.get(
  '/changes',
  async ({ query }) => {
    try {
      const { listChangeSessions } = await import('../utils/changeStorage')
      const { status, limit = 50, offset = 0 } = query
      
      let sessions = await listChangeSessions()

      // Filter by status if provided
      if (status && status !== 'all') {
        sessions = sessions.filter((s) => s.status === status)
      }

      // Sort by most recent first
      sessions.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )

      // Apply pagination
      const total = sessions.length
      const paginatedSessions = sessions.slice(Number(offset), Number(offset) + Number(limit))

      // Transform to API format
      const changes = paginatedSessions.map((session) => {
        const changeCount = {
          added: session.changes.filter(c => c.changeType === 'added').length,
          modified: session.changes.filter(c => c.changeType === 'modified').length,
          deleted: session.changes.filter(c => c.changeType === 'deleted').length,
          total: session.changes.length
        }

        // Calculate progress
        const steps = Object.values(session.steps)
        const completedSteps = steps.filter(s => s.completed).length
        const totalSteps = steps.length
        const progress = {
          current: completedSteps,
          total: totalSteps,
          percentage: Math.round((completedSteps / totalSteps) * 100)
        }

        return {
          sessionId: session.sessionId,
          repositoryName: `${session.repository.owner}/${session.repository.name}`,
          repository: {
            owner: session.repository.owner,
            name: session.repository.name,
            baseBranch: session.repository.baseBranch
          },
          commit: session.commit,
          status: session.status,
          automationMode: session.automationMode,
          sourceLocale: session.sourceLocale,
          targetLocales: session.targetLocales,
          changeCount,
          progress,
          steps: session.steps,
          batchId: session.steps.batchCreated.batchId,
          pullRequestNumber: session.steps.prCreated.pullRequestNumber,
          pullRequestUrl: session.steps.prCreated.pullRequestUrl,
          deletionPullRequest: session.deletionPullRequest,
          hasErrors: session.errors.length > 0,
          errorCount: session.errors.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        }
      })

      return {
        changes,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + Number(limit) < total
        }
      }
    } catch (error) {
      log.error('Error listing changes:', error)
      return { error: 'Failed to list changes', changes: [] }
    }
  },
  {
    query: t.Object({
      status: t.Optional(t.Union([
        t.Literal('all'),
        t.Literal('uploaded'),
        t.Literal('batch-created'),
        t.Literal('submitted'),
        t.Literal('processing'),
        t.Literal('completed'),
        t.Literal('failed'),
        t.Literal('pr-created')
      ])),
      limit: t.Optional(t.Numeric({ default: 50 })),
      offset: t.Optional(t.Numeric({ default: 0 }))
    })
  }
)

/**
 * GET /api/changes/:sessionId
 * Get detailed information about a specific change session
 */
dashboardRoutes.get('/changes/:sessionId', async ({ params }) => {
  try {
    const { loadChangeSession } = await import('../utils/changeStorage')
    const { sessionId } = params
    const session = await loadChangeSession(sessionId)

    if (!session) {
      return { error: 'Change session not found' }
    }

    const changeCount = {
      added: session.changes.filter(c => c.changeType === 'added').length,
      modified: session.changes.filter(c => c.changeType === 'modified').length,
      deleted: session.changes.filter(c => c.changeType === 'deleted').length,
      total: session.changes.length
    }

    const steps = Object.values(session.steps)
    const completedSteps = steps.filter(s => s.completed).length
    const totalSteps = steps.length
    const progress = {
      current: completedSteps,
      total: totalSteps,
      percentage: Math.round((completedSteps / totalSteps) * 100)
    }

    return {
      sessionId: session.sessionId,
      repositoryName: `${session.repository.owner}/${session.repository.name}`,
      repository: session.repository,
      commit: session.commit,
      status: session.status,
      automationMode: session.automationMode,
      sourceLocale: session.sourceLocale,
      targetLocales: session.targetLocales,
      changes: session.changes,
      changeCount,
      progress,
      steps: session.steps,
      errors: session.errors,
      deletionPullRequest: session.deletionPullRequest,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }
  } catch (error) {
    log.error('Error getting change session:', error)
    return { error: 'Failed to get change session' }
  }
})

/**
 * DELETE /api/changes/:sessionId
 * Delete a change session
 */
dashboardRoutes.delete('/changes/:sessionId', async ({ params }) => {
  try {
    const { deleteChangeSession } = await import('../utils/changeStorage')
    const { sessionId } = params
    
    const success = await deleteChangeSession(sessionId)
    
    if (!success) {
      return { error: 'Change session not found' }
    }

    log.info('Deleted change session via API', { sessionId })
    
    return { 
      success: true,
      message: 'Change session deleted successfully' 
    }
  } catch (error) {
    log.error('Error deleting change session:', error)
    return { error: 'Failed to delete change session' }
  }
})

export default dashboardRoutes
