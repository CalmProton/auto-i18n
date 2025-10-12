import { Elysia } from 'elysia'
import { isSupportedLocale } from '../config/locales'
import type { 
  ErrorResponse, 
  ChangesUploadRequest, 
  ChangeProcessResponse,
  AutomationMode
} from '../types'
import { createScopedLogger } from '../utils/logger'
import { processChanges } from '../services/changeProcessor'
import {
  loadChangeSession,
  updateChangeSessionStatus,
  addChangeSessionError,
  deleteChangeSession,
  changeSessionExists
} from '../utils/changeStorage'

const changesRoutes = new Elysia({ prefix: '/translate/changes' })
const log = createScopedLogger('routes:changes')

/**
 * POST /translate/changes
 * Upload changed files for incremental translation
 */
changesRoutes.post('/', async ({ body, set, request }) => {
  try {
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null
    if (!payload) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'Request body is required' }
      return errorResponse
    }

    // Extract and validate request data
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    const sourceLocale = typeof payload.sourceLocale === 'string' ? payload.sourceLocale.trim() : ''
    
    const targetLocales = Array.isArray(payload.targetLocales)
      ? payload.targetLocales.filter((l): l is string => typeof l === 'string').map(l => l.trim())
      : []

    const automationMode = (typeof payload.automationMode === 'string' 
      ? payload.automationMode 
      : 'manual') as AutomationMode

    log.info('Received changes upload request', {
      sessionId,
      sourceLocale,
      targetLocales,
      automationMode,
      url: request.url
    })

    // Validate required fields
    if (!sessionId) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'sessionId is required' }
      return errorResponse
    }

    if (!sourceLocale || !isSupportedLocale(sourceLocale)) {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: `Invalid or unsupported sourceLocale: ${sourceLocale}` 
      }
      return errorResponse
    }

    if (targetLocales.length === 0) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'At least one targetLocale is required' }
      return errorResponse
    }

    // Validate target locales
    for (const locale of targetLocales) {
      if (!isSupportedLocale(locale)) {
        set.status = 400
        const errorResponse: ErrorResponse = { 
          error: `Invalid or unsupported targetLocale: ${locale}` 
        }
        return errorResponse
      }
    }

    // Check if session already exists
    if (changeSessionExists(sessionId)) {
      set.status = 409
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} already exists` 
      }
      return errorResponse
    }

    // Extract repository metadata
    const repository = payload.repository as any
    if (!repository || !repository.owner || !repository.name) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'Repository metadata is required' }
      return errorResponse
    }

    // Extract changes
    const changes = Array.isArray(payload.changes) ? payload.changes : []
    if (changes.length === 0) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'At least one change is required' }
      return errorResponse
    }

    // Extract files from multipart form data
    const files = new Map<string, File>()
    for (const [key, value] of Object.entries(payload)) {
      if (value instanceof File) {
        files.set(key, value)
      }
    }

    log.info('Processing changes', {
      sessionId,
      changeCount: changes.length,
      filesCount: files.size
    })

    // Build request
    const uploadRequest: ChangesUploadRequest = {
      sessionId,
      repository: {
        owner: repository.owner,
        name: repository.name,
        baseBranch: repository.baseBranch || 'main',
        baseCommitSha: repository.baseCommitSha,
        commitSha: repository.commitSha,
        commitMessage: repository.commitMessage || 'Update translations',
        commitAuthor: repository.commitAuthor
      },
      sourceLocale,
      targetLocales,
      changes: changes.map((c: any) => ({
        path: c.path,
        type: c.type,
        changeType: c.changeType
      })),
      automationMode
    }

    // Process changes
    const metadata = await processChanges(uploadRequest, files)

    // If automation mode is auto, trigger batch creation
    if (automationMode === 'auto') {
      // Note: This will be handled by a background job or webhook
      // For now, we just log it
      log.info('Auto mode enabled, batch will be created automatically', { sessionId })
    }

    const response: ChangeProcessResponse = {
      sessionId: metadata.sessionId,
      status: metadata.status,
      message: 'Changes uploaded successfully'
    }

    return response
  } catch (error) {
    log.error('Failed to process changes upload', { error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to process changes' 
    }
    return errorResponse
  }
})

/**
 * POST /translate/changes/:sessionId/process
 * Start batch processing for the change session
 */
changesRoutes.post('/:sessionId/process', async ({ params, set }) => {
  const { sessionId } = params

  try {
    log.info('Processing change session', { sessionId })

    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    if (metadata.status !== 'uploaded') {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: `Change session is in ${metadata.status} status, cannot process` 
      }
      return errorResponse
    }

    // TODO: Implement batch creation logic
    // This will be similar to existing batch creation but for changes
    
    const response: ChangeProcessResponse = {
      sessionId,
      status: 'batch-created',
      message: 'Batch processing started (not yet implemented)'
    }

    return response
  } catch (error) {
    log.error('Failed to process change session', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to process change session' 
    }
    return errorResponse
  }
})

/**
 * GET /translate/changes/:sessionId/status
 * Get current status of a change session
 */
changesRoutes.get('/:sessionId/status', async ({ params, set }) => {
  const { sessionId } = params

  try {
    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    return {
      sessionId: metadata.sessionId,
      status: metadata.status,
      progress: {
        uploaded: metadata.steps.uploaded,
        batchCreated: metadata.steps.batchCreated,
        submitted: metadata.steps.submitted,
        processing: metadata.steps.processing,
        completed: metadata.steps.completed,
        prCreated: metadata.steps.prCreated
      },
      changes: metadata.changes,
      errors: metadata.errors,
      repository: metadata.repository,
      commit: metadata.commit,
      automationMode: metadata.automationMode
    }
  } catch (error) {
    log.error('Failed to get change session status', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to get status' 
    }
    return errorResponse
  }
})

/**
 * POST /translate/changes/:sessionId/finalize
 * Create GitHub PR for the translated changes
 */
changesRoutes.post('/:sessionId/finalize', async ({ params, set }) => {
  const { sessionId } = params

  try {
    log.info('Finalizing change session', { sessionId })

    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    if (metadata.status !== 'completed') {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: `Change session is in ${metadata.status} status, cannot finalize` 
      }
      return errorResponse
    }

    // TODO: Implement PR creation logic
    
    const response: ChangeProcessResponse = {
      sessionId,
      status: 'pr-created',
      message: 'PR creation (not yet implemented)'
    }

    return response
  } catch (error) {
    log.error('Failed to finalize change session', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to finalize' 
    }
    return errorResponse
  }
})

/**
 * DELETE /translate/changes/:sessionId
 * Delete a change session
 */
changesRoutes.delete('/:sessionId', async ({ params, set }) => {
  const { sessionId } = params

  try {
    log.info('Deleting change session', { sessionId })

    const success = await deleteChangeSession(sessionId)
    if (!success) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    return { message: 'Change session deleted successfully' }
  } catch (error) {
    log.error('Failed to delete change session', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to delete' 
    }
    return errorResponse
  }
})

export default changesRoutes
