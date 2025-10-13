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
    
    // Parse targetLocales - can be array or JSON string
    let targetLocales: string[] = []
    if (Array.isArray(payload.targetLocales)) {
      targetLocales = payload.targetLocales.filter((l): l is string => typeof l === 'string').map(l => l.trim())
    } else if (typeof payload.targetLocales === 'string') {
      try {
        const parsed = JSON.parse(payload.targetLocales)
        if (Array.isArray(parsed)) {
          targetLocales = parsed.filter((l): l is string => typeof l === 'string').map(l => l.trim())
        }
      } catch (e) {
        log.warn('Failed to parse targetLocales JSON string', { error: e })
      }
    }

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

    // Extract repository metadata - can be object or JSON string
    let repository: any = null
    if (typeof payload.repository === 'object' && payload.repository !== null) {
      repository = payload.repository
    } else if (typeof payload.repository === 'string') {
      try {
        repository = JSON.parse(payload.repository)
      } catch (e) {
        log.warn('Failed to parse repository JSON string', { error: e })
      }
    }
    
    if (!repository || !repository.owner || !repository.name) {
      set.status = 400
      const errorResponse: ErrorResponse = { error: 'Repository metadata is required' }
      return errorResponse
    }

    // Extract changes - can be array or JSON string
    let changes: any[] = []
    if (Array.isArray(payload.changes)) {
      changes = payload.changes
    } else if (typeof payload.changes === 'string') {
      try {
        const parsed = JSON.parse(payload.changes)
        if (Array.isArray(parsed)) {
          changes = parsed
        }
      } catch (e) {
        log.warn('Failed to parse changes JSON string', { error: e })
      }
    }
    
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

    // If automation mode is auto, trigger the full pipeline asynchronously
    if (automationMode === 'auto') {
      log.info('Auto mode enabled - starting automated pipeline', { sessionId })
      
      // Start pipeline in background - don't await to avoid blocking response
      runAutoPipeline(sessionId).catch(err => {
        log.error('Auto pipeline failed', { sessionId, error: err })
      })
    }

    const response: ChangeProcessResponse = {
      sessionId: metadata.sessionId,
      status: metadata.status,
      message: automationMode === 'auto' 
        ? 'Changes uploaded successfully. Automated translation pipeline started.'
        : 'Changes uploaded successfully'
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

    // Find delta files recursively (they're organized by locale/type)
    const { getChangeDeltasPath } = await import('../utils/changeStorage')
    const { readdirSync, existsSync, statSync } = await import('fs')
    const { join: pathJoin } = await import('path')
    
    const deltasPath = getChangeDeltasPath(sessionId)
    let deltaFiles: string[] = []
    
    // Recursively find all .delta.json files
    const findDeltaFiles = (dir: string): void => {
      if (!existsSync(dir)) {
        log.warn('Directory does not exist', { dir })
        return
      }
      
      try {
        const entries = readdirSync(dir)
        log.info('Scanning directory', { dir, entryCount: entries.length, entries })
        
        for (const entry of entries) {
          const fullPath = pathJoin(dir, entry)
          let stat
          try {
            stat = statSync(fullPath)
          } catch (err) {
            log.warn('Failed to stat file', { fullPath, error: err })
            continue
          }
          
          if (stat.isDirectory()) {
            log.info('Recursing into subdirectory', { fullPath })
            findDeltaFiles(fullPath)
          } else if (entry.endsWith('.delta.json')) {
            log.info('Found delta file', { fullPath })
            deltaFiles.push(fullPath)
          }
        }
      } catch (error) {
        log.error('Error scanning directory', { dir, error })
      }
    }
    
    findDeltaFiles(deltasPath)

    if (deltaFiles.length === 0) {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: 'No translatable changes found. All changes were either deletions or had no content differences.' 
      }
      return errorResponse
    }

    log.info('Found delta files for batch creation', { sessionId, count: deltaFiles.length, files: deltaFiles })

    // Create batch from delta files
    const { createDeltaBatch } = await import('../services/translation/deltaBatchService')
    
    try {
      const batchResult = await createDeltaBatch({
        sessionId,
        sourceLocale: metadata.sourceLocale,
        targetLocales: metadata.targetLocales,
        deltaFiles
      })

      // Update change session status
      metadata.steps.batchCreated = {
        completed: true,
        timestamp: new Date().toISOString(),
        batchId: batchResult.batchId
      }
      metadata.status = 'batch-created'
      metadata.updatedAt = new Date().toISOString()
      
      await updateChangeSessionStatus(sessionId, 'batch-created', metadata.steps)

      log.info('Delta batch created successfully', { sessionId, batchId: batchResult.batchId })

      const response: ChangeProcessResponse = {
        sessionId,
        status: 'batch-created',
        message: `Batch created successfully with ${batchResult.requestCount} translation requests`,
        batchId: batchResult.batchId
      }

      return response
    } catch (error) {
      await addChangeSessionError(sessionId, 'batch-creation',
        error instanceof Error ? error.message : 'Failed to create batch'
      )
      throw error
    }
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

/**
 * Run the automated pipeline for change sessions
 * Steps: Create batch → Submit to OpenAI → Monitor → Process results → Ready for PR
 */
async function runAutoPipeline(sessionId: string): Promise<void> {
  try {
    log.info('Starting auto pipeline', { sessionId })

    // Small delay to ensure file system operations are complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // Step 1: Create batch from deltas
    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      throw new Error('Change session not found')
    }

    // Find delta files recursively (they're organized by locale/type)
    const { getChangeDeltasPath } = await import('../utils/changeStorage')
    const { readdirSync, existsSync, statSync } = await import('fs')
    const { join: pathJoin } = await import('path')
    
    const deltasPath = getChangeDeltasPath(sessionId)
    let deltaFiles: string[] = []
    
    log.info('Searching for delta files', { sessionId, deltasPath, exists: existsSync(deltasPath) })
    
    // Recursively find all .delta.json files
    const findDeltaFiles = (dir: string): void => {
      if (!existsSync(dir)) {
        log.warn('Directory does not exist', { dir })
        return
      }
      
      try {
        const entries = readdirSync(dir)
        log.info('Scanning directory', { dir, entryCount: entries.length, entries })
        
        for (const entry of entries) {
          const fullPath = pathJoin(dir, entry)
          let stat
          try {
            stat = statSync(fullPath)
          } catch (err) {
            log.warn('Failed to stat file', { fullPath, error: err })
            continue
          }
          
          if (stat.isDirectory()) {
            log.info('Recursing into subdirectory', { fullPath })
            findDeltaFiles(fullPath)
          } else if (entry.endsWith('.delta.json')) {
            log.info('Found delta file', { fullPath })
            deltaFiles.push(fullPath)
          } else {
            log.info('Skipping non-delta file', { entry, fullPath })
          }
        }
      } catch (error) {
        log.error('Error scanning directory', { dir, error })
      }
    }
    
    findDeltaFiles(deltasPath)

    if (deltaFiles.length === 0) {
      log.warn('No delta files found, skipping auto pipeline', { sessionId, deltasPath })
      return
    }
    
    log.info('Found delta files for auto pipeline', { sessionId, count: deltaFiles.length, files: deltaFiles })

    // Create batch
    const { createDeltaBatch } = await import('../services/translation/deltaBatchService')
    const batchResult = await createDeltaBatch({
      sessionId,
      sourceLocale: metadata.sourceLocale,
      targetLocales: metadata.targetLocales,
      deltaFiles
    })

    metadata.steps.batchCreated = {
      completed: true,
      timestamp: new Date().toISOString(),
      batchId: batchResult.batchId
    }
    metadata.status = 'batch-created'
    metadata.updatedAt = new Date().toISOString()
    await updateChangeSessionStatus(sessionId, 'batch-created', metadata.steps)

    log.info('Auto pipeline: Batch created', { sessionId, batchId: batchResult.batchId })

    // Step 2: Submit batch to OpenAI
    const { submitBatch } = await import('../services/translation/openaiBatchService')
    const submitResult = await submitBatch({
      senderId: sessionId,
      batchId: batchResult.batchId
    })

    metadata.steps.submitted = {
      completed: true,
      timestamp: new Date().toISOString(),
      openAiBatchId: submitResult.openaiBatchId
    }
    metadata.status = 'submitted'
    metadata.updatedAt = new Date().toISOString()
    await updateChangeSessionStatus(sessionId, 'submitted', metadata.steps)

    log.info('Auto pipeline: Batch submitted to OpenAI', { 
      sessionId, 
      batchId: batchResult.batchId,
      openAiBatchId: submitResult.openaiBatchId 
    })

    // Trigger immediate status check
    const { triggerImmediatePoll } = await import('../services/batchPollingService')
    triggerImmediatePoll()

    // Note: Batch will be processed on OpenAI's servers
    // Background polling service will check status every 30 seconds
    log.info('Auto pipeline: Batch submitted successfully. Background polling started.', { sessionId })

  } catch (error) {
    log.error('Auto pipeline failed', { sessionId, error })
    await addChangeSessionError(sessionId, 'auto-pipeline',
      error instanceof Error ? error.message : 'Auto pipeline failed'
    )
  }
}

export default changesRoutes
