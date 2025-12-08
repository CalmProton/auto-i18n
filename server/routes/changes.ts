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
    const { getChangeDeltasPath, getChangeOriginalFilesPath } = await import('../utils/changeStorage')
    const { readdirSync, existsSync, statSync } = await import('fs')
    const { join: pathJoin } = await import('path')
    
    const deltasPath = getChangeDeltasPath(sessionId)
    const originalFilesPath = getChangeOriginalFilesPath(sessionId)
    let deltaFiles: string[] = []
    let contentFiles: string[] = []
    
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
    
    // Recursively find all content files (markdown)
    const findContentFiles = (dir: string): void => {
      if (!existsSync(dir)) {
        log.warn('Content directory does not exist', { dir })
        return
      }
      
      try {
        const entries = readdirSync(dir)
        log.info('Scanning content directory', { dir, entryCount: entries.length, entries })
        
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
            log.info('Recursing into content subdirectory', { fullPath })
            findContentFiles(fullPath)
          } else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
            log.info('Found content file', { fullPath })
            contentFiles.push(fullPath)
          }
        }
      } catch (error) {
        log.error('Error scanning content directory', { dir, error })
      }
    }
    
    findDeltaFiles(deltasPath)
    findContentFiles(originalFilesPath)

    if (deltaFiles.length === 0 && contentFiles.length === 0) {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: 'No translatable changes found. All changes were either deletions or had no content differences.' 
      }
      return errorResponse
    }

    log.info('Found files for batch creation', { 
      sessionId, 
      deltaCount: deltaFiles.length, 
      contentCount: contentFiles.length,
      deltaFiles, 
      contentFiles 
    })

    // Create batch from delta and content files
    const { createDeltaBatch } = await import('../services/translation/deltaBatchService')
    
    try {
      const batchResult = await createDeltaBatch({
        sessionId,
        sourceLocale: metadata.sourceLocale,
        targetLocales: metadata.targetLocales,
        deltaFiles,
        contentFiles
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
 * POST /translate/changes/:sessionId/retry-batch-output
 * Retry processing batch output files
 */
changesRoutes.post('/:sessionId/retry-batch-output', async ({ params, set }) => {
  const { sessionId } = params

  try {
    log.info('Retrying batch output processing', { sessionId })

    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    const batchId = metadata.steps.batchCreated?.batchId
    if (!batchId) {
      set.status = 400
      const errorResponse: ErrorResponse = { 
        error: 'No batch ID found for this session' 
      }
      return errorResponse
    }

    // Import and call the output processor
    const { processDeltaBatchOutput } = await import('../services/translation/deltaBatchOutputProcessor')
    
    log.info('Processing delta batch output', { sessionId, batchId })
    const result = await processDeltaBatchOutput(sessionId, batchId)

    log.info('Delta batch output processed successfully', {
      sessionId,
      batchId,
      processedCount: result.processedCount,
      errorCount: result.errorCount
    })

    // Update session status to completed
    await updateChangeSessionStatus(sessionId, 'completed', {
      completed: {
        completed: true,
        timestamp: new Date().toISOString(),
        translationCount: result.processedCount
      }
    })

    log.info('Change session marked as completed', { sessionId, translationCount: result.processedCount })

    // Trigger PR creation if output processing succeeded
    if (result.processedCount > 0) {
      const { createChangePR } = await import('../services/github/changeWorkflow')
      
      try {
        log.info('Creating pull request for change session', { sessionId })
        const prResult = await createChangePR({ sessionId })

        await updateChangeSessionStatus(sessionId, 'pr-created', {
          prCreated: {
            completed: true,
            timestamp: new Date().toISOString(),
            pullRequestNumber: prResult.pullRequestNumber,
            pullRequestUrl: prResult.pullRequestUrl,
            branchName: prResult.branchName
          }
        })

        log.info('Pull request created successfully', {
          sessionId,
          prNumber: prResult.pullRequestNumber,
          prUrl: prResult.pullRequestUrl
        })
      } catch (prError) {
        log.error('Failed to create pull request after output processing', { sessionId, error: prError })
        // Don't fail the whole request, just log the error
      }
    }

    return {
      success: true,
      sessionId,
      batchId,
      processedCount: result.processedCount,
      errorCount: result.errorCount,
      translationsByLocale: result.translationsByLocale
    }
  } catch (error) {
    log.error('Failed to retry batch output processing', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to retry batch output processing' 
    }
    return errorResponse
  }
})

/**
 * POST /translate/changes/:sessionId/retry-pr
 * Retry creating pull request
 */
changesRoutes.post('/:sessionId/retry-pr', async ({ params, set }) => {
  const { sessionId } = params

  try {
    log.info('Retrying PR creation', { sessionId })

    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    const { createChangePR } = await import('../services/github/changeWorkflow')
    
    const result = await createChangePR({ sessionId })

    await updateChangeSessionStatus(sessionId, 'pr-created', {
      prCreated: {
        completed: true,
        timestamp: new Date().toISOString(),
        pullRequestNumber: result.pullRequestNumber,
        pullRequestUrl: result.pullRequestUrl,
        branchName: result.branchName
      }
    })

    log.info('Pull request created successfully', {
      sessionId,
      prNumber: result.pullRequestNumber,
      prUrl: result.pullRequestUrl
    })

    return {
      success: true,
      sessionId,
      pullRequestNumber: result.pullRequestNumber,
      pullRequestUrl: result.pullRequestUrl,
      branchName: result.branchName,
      filesChanged: result.filesChanged
    }
  } catch (error) {
    log.error('Failed to retry PR creation', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to retry PR creation' 
    }
    return errorResponse
  }
})

/**
 * POST /translate/changes/:sessionId/reset
 * Reset session to allow reprocessing or creating a new PR
 * Query params:
 * - full=true: Reset all steps (batch, translations, PR) to start from scratch
 * - full=false (default): Only reset PR step to retry PR creation with existing translations
 */
changesRoutes.post('/:sessionId/reset', async ({ params, query, set }) => {
  const { sessionId } = params
  const fullReset = query.full === 'true'

  try {
    log.info('Resetting change session', { sessionId, fullReset })

    const metadata = await loadChangeSession(sessionId)
    if (!metadata) {
      set.status = 404
      const errorResponse: ErrorResponse = { 
        error: `Change session ${sessionId} not found` 
      }
      return errorResponse
    }

    if (fullReset) {
      // Full reset - clear translations to start from scratch
      // But preserve batch info if batch is already completed
      log.info('Performing full reset - clearing translation steps', { sessionId })
      
      // Check if we have a completed batch by scanning the batches directory
      let hasCompletedBatch = false
      let batchId: string | undefined
      let openAiBatchId: string | undefined
      
      const { existsSync, readdirSync, readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { getTempRoot } = await import('../utils/fileStorage')
      const batchesPath = join(getTempRoot(), sessionId, 'batches')
      
      if (existsSync(batchesPath)) {
        try {
          const batchDirs = readdirSync(batchesPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
          
          for (const dir of batchDirs) {
            const manifestPath = join(batchesPath, dir, 'manifest.json')
            if (existsSync(manifestPath)) {
              const manifestContent = readFileSync(manifestPath, 'utf8')
              const manifest = JSON.parse(manifestContent)
              
              if (manifest.status === 'completed') {
                hasCompletedBatch = true
                batchId = manifest.batchId
                openAiBatchId = manifest.openai?.batchId
                log.info('Found existing completed batch', { 
                  sessionId, 
                  batchId,
                  openAiBatchId,
                  batchStatus: manifest.status
                })
                break // Use the first completed batch found
              }
            }
          }
        } catch (error) {
          log.warn('Failed to scan for completed batches', { sessionId, error })
        }
      }
      
      if (hasCompletedBatch && batchId) {
        // Keep batch steps, only reset translation processing
        log.info('Preserving completed batch, resetting only translation steps', { 
          sessionId, 
          batchId,
          openAiBatchId 
        })
        
        // Restore batch metadata
        metadata.steps.batchCreated = {
          completed: true,
          batchId,
          timestamp: new Date().toISOString()
        }
        metadata.steps.submitted = {
          completed: true,
          openAiBatchId: openAiBatchId || '',
          timestamp: new Date().toISOString()
        }
        metadata.steps.processing = { completed: false }
        metadata.steps.completed = { completed: false }
        metadata.steps.prCreated = { completed: false }
        metadata.status = 'processing'
      } else {
        // No completed batch - reset everything
        log.info('No completed batch found, resetting all steps', { sessionId })
        metadata.steps.batchCreated = { completed: false }
        metadata.steps.submitted = { completed: false }
        metadata.steps.processing = { completed: false }
        metadata.steps.completed = { completed: false }
        metadata.steps.prCreated = { completed: false }
        metadata.status = 'uploaded'
      }
      
      // Clear all errors
      metadata.errors = []
      
      // Delete translation files
      const { deleteTranslations } = await import('../utils/changeStorage')
      await deleteTranslations(sessionId)
      
    } else {
      // PR-only reset - keep translations, just reset PR step
      log.info('Performing PR reset only', { sessionId })
      
      // Reset the prCreated step to allow new PR creation
      metadata.steps.prCreated = {
        completed: false
      }
      
      // Update status back to completed
      metadata.status = 'completed'
      
      // Clear PR-related errors
      metadata.errors = metadata.errors.filter(e => 
        !e.step.includes('pr') && 
        !e.step.includes('finalize') &&
        !e.step.includes('auto-pipeline')
      )
    }

    metadata.updatedAt = new Date().toISOString()

    // Save updated metadata
    const { saveChangeSession } = await import('../utils/changeStorage')
    await saveChangeSession(metadata)

    let message: string
    if (fullReset) {
      if (metadata.status === 'processing') {
        message = 'Session reset. Existing completed batch preserved. Click "Retry Output" to process translations.'
      } else {
        message = 'Session fully reset. Click "Process" to create a new batch and translations.'
      }
    } else {
      message = 'Session reset. You can now retry creating a new PR with existing translations.'
    }
    
    log.info('Change session reset successfully', { sessionId, fullReset, newStatus: metadata.status })

    return {
      success: true,
      sessionId,
      fullReset,
      message
    }
  } catch (error) {
    log.error('Failed to reset change session', { sessionId, error })
    set.status = 500
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'Failed to reset session' 
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
