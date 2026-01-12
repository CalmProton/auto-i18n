/**
 * Background service for polling batch statuses (OpenAI and Anthropic)
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScopedLogger } from '../utils/logger'
import { checkBatchStatus } from './translation/unifiedBatchService'
import type { BatchManifest, BatchProvider } from './translation/batchTypes'

const log = createScopedLogger('services:batchPolling')

const TMP_DIR = join(process.cwd(), 'tmp')
const POLL_INTERVAL_MS = 30 * 1000 // 30 seconds
const BATCHES_DIR = 'batches'
const MANIFEST_FILE = 'manifest.json'

let pollingInterval: Timer | null = null
let isPolling = false

interface PendingBatch {
  senderId: string
  batchId: string
  provider: BatchProvider
  providerBatchId: string
}

/**
 * Find all pending batches across all sessions (both OpenAI and Anthropic)
 */
function findPendingBatches(): PendingBatch[] {
  const pendingBatches: PendingBatch[] = []

  if (!existsSync(TMP_DIR)) {
    return pendingBatches
  }

  try {
    const senderIds = readdirSync(TMP_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)

    for (const senderId of senderIds) {
      const batchesPath = join(TMP_DIR, senderId, BATCHES_DIR)
      
      if (!existsSync(batchesPath)) {
        continue
      }

      const batchIds = readdirSync(batchesPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)

      for (const batchId of batchIds) {
        const manifestPath = join(batchesPath, batchId, MANIFEST_FILE)
        
        if (!existsSync(manifestPath)) {
          continue
        }

        try {
          const manifestContent = readFileSync(manifestPath, 'utf-8')
          const manifest = JSON.parse(manifestContent) as BatchManifest

          // Check if batch is in a pending state
          const isSubmitted = manifest.status === 'submitted'
          
          // Check for OpenAI batches
          if (isSubmitted && manifest.openai?.batchId) {
            const openaiStatus = manifest.openai.status
            if (openaiStatus && !['completed', 'failed', 'expired', 'cancelled'].includes(openaiStatus)) {
              pendingBatches.push({
                senderId,
                batchId,
                provider: 'openai',
                providerBatchId: manifest.openai.batchId
              })
            }
          }
          
          // Check for Anthropic batches
          if (isSubmitted && manifest.anthropic?.batchId) {
            const anthropicStatus = manifest.anthropic.processingStatus || manifest.anthropic.status
            if (anthropicStatus && !['ended', 'canceling'].includes(anthropicStatus)) {
              pendingBatches.push({
                senderId,
                batchId,
                provider: 'anthropic',
                providerBatchId: manifest.anthropic.batchId
              })
            }
          }
        } catch (error) {
          log.warn('Failed to read manifest', { senderId, batchId, error })
        }
      }
    }
  } catch (error) {
    log.error('Error finding pending batches', { error })
  }

  return pendingBatches
}

/**
 * Get previous status from manifest
 */
function getPreviousStatus(manifest: BatchManifest): string | undefined {
  if (manifest.provider === 'anthropic' && manifest.anthropic) {
    return manifest.anthropic.processingStatus || manifest.anthropic.status
  }
  if (manifest.openai) {
    return manifest.openai.status
  }
  return undefined
}

/**
 * Poll all pending batches once
 */
async function pollPendingBatches() {
  if (isPolling) {
    log.debug('Polling already in progress, skipping')
    return
  }

  isPolling = true

  try {
    const pendingBatches = findPendingBatches()

    if (pendingBatches.length === 0) {
      log.debug('No pending batches to poll')
      return
    }

    log.info('Polling batch statuses', { 
      count: pendingBatches.length,
      openai: pendingBatches.filter(b => b.provider === 'openai').length,
      anthropic: pendingBatches.filter(b => b.provider === 'anthropic').length
    })

    // Store previous statuses to detect changes
    const previousStatuses = new Map<string, string>()
    for (const { senderId, batchId } of pendingBatches) {
      const manifestPath = join(TMP_DIR, senderId, BATCHES_DIR, batchId, MANIFEST_FILE)
      try {
        const manifestContent = readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestContent) as BatchManifest
        const prevStatus = getPreviousStatus(manifest)
        if (prevStatus) {
          previousStatuses.set(batchId, prevStatus)
        }
      } catch {
        // Ignore errors
      }
    }

    const results = await Promise.allSettled(
      pendingBatches.map(async ({ senderId, batchId, provider, providerBatchId }) => {
        try {
          const result = await checkBatchStatus({ senderId, batchId })
          
          // Check if status changed
          const previousStatus = previousStatuses.get(batchId)
          if (previousStatus && previousStatus !== result.status) {
            log.info('🔄 Batch status CHANGED', {
              senderId,
              batchId,
              provider,
              providerBatchId,
              previousStatus,
              newStatus: result.status,
              requestCounts: result.requestCounts
            })
          } else {
            log.info('Batch status checked', {
              senderId,
              batchId,
              provider,
              providerBatchId,
              status: result.status,
              requestCounts: result.requestCounts
            })
          }

          return result
        } catch (error) {
          log.error('Failed to check batch status', { senderId, batchId, provider, providerBatchId, error })
          throw error
        }
      })
    )

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    log.info('Batch polling completed', {
      total: pendingBatches.length,
      succeeded,
      failed
    })
  } catch (error) {
    log.error('Error during batch polling', { error })
  } finally {
    isPolling = false
  }
}

/**
 * Start the background polling service
 */
export function startBatchPolling() {
  if (pollingInterval) {
    log.warn('Batch polling already started')
    return
  }

  log.info('Starting batch polling service', { intervalMs: POLL_INTERVAL_MS })

  // Poll immediately on startup
  pollPendingBatches().catch(error => {
    log.error('Initial batch polling failed', { error })
  })

  // Then poll on interval
  pollingInterval = setInterval(() => {
    pollPendingBatches().catch(error => {
      log.error('Scheduled batch polling failed', { error })
    })
  }, POLL_INTERVAL_MS)
}

/**
 * Stop the background polling service
 */
export function stopBatchPolling() {
  if (!pollingInterval) {
    log.warn('Batch polling not running')
    return
  }

  log.info('Stopping batch polling service')
  clearInterval(pollingInterval)
  pollingInterval = null
}

/**
 * Trigger an immediate poll (useful after submitting a new batch)
 */
export function triggerImmediatePoll() {
  log.info('Triggering immediate batch poll')
  pollPendingBatches().catch(error => {
    log.error('Immediate batch polling failed', { error })
  })
}
