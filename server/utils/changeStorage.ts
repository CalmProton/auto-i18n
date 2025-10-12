import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangeSessionMetadata, ChangeStatus } from '../types'
import { tempRoot } from './fileStorage'
import { createScopedLogger } from './logger'

const log = createScopedLogger('utils:changeStorage')
const CHANGES_DIR = 'changes'
const METADATA_FILE = 'metadata.json'

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function getChangeSessionPath(sessionId: string): string {
  return join(tempRoot, sanitizeSegment(sessionId), CHANGES_DIR)
}

export function getChangeMetadataPath(sessionId: string): string {
  return join(getChangeSessionPath(sessionId), METADATA_FILE)
}

export function getChangeOriginalFilesPath(sessionId: string): string {
  return join(getChangeSessionPath(sessionId), 'original')
}

export function getChangeDeltaPath(sessionId: string, locale: string): string {
  return join(tempRoot, sanitizeSegment(sessionId), 'deltas', locale)
}

export function getChangeDeltasPath(sessionId: string): string {
  return join(tempRoot, sanitizeSegment(sessionId), 'deltas')
}

/**
 * Load change session metadata
 */
export async function loadChangeSession(sessionId: string): Promise<ChangeSessionMetadata | null> {
  const metadataPath = getChangeMetadataPath(sessionId)
  
  if (!existsSync(metadataPath)) {
    log.debug('Change session metadata not found', { sessionId, metadataPath })
    return null
  }

  try {
    const content = await readFile(metadataPath, 'utf8')
    const metadata = JSON.parse(content) as ChangeSessionMetadata
    
    log.debug('Loaded change session metadata', { 
      sessionId, 
      status: metadata.status,
      changeCount: metadata.changes.length
    })
    
    return metadata
  } catch (error) {
    log.error('Failed to load change session metadata', { 
      sessionId, 
      metadataPath, 
      error 
    })
    return null
  }
}

/**
 * Save change session metadata
 */
export async function saveChangeSession(metadata: ChangeSessionMetadata): Promise<void> {
  const metadataPath = getChangeMetadataPath(metadata.sessionId)
  const directory = getChangeSessionPath(metadata.sessionId)

  await mkdir(directory, { recursive: true })

  metadata.updatedAt = new Date().toISOString()
  const payload = JSON.stringify(metadata, null, 2)

  await writeFile(metadataPath, payload, 'utf8')

  log.info('Saved change session metadata', {
    sessionId: metadata.sessionId,
    status: metadata.status,
    metadataPath
  })
}

/**
 * Update change session status
 */
export async function updateChangeSessionStatus(
  sessionId: string,
  status: ChangeStatus,
  stepUpdates?: Partial<ChangeSessionMetadata['steps']>
): Promise<ChangeSessionMetadata | null> {
  const metadata = await loadChangeSession(sessionId)
  
  if (!metadata) {
    log.error('Cannot update status: session not found', { sessionId })
    return null
  }

  metadata.status = status
  metadata.updatedAt = new Date().toISOString()

  if (stepUpdates) {
    Object.assign(metadata.steps, stepUpdates)
  }

  await saveChangeSession(metadata)
  
  log.info('Updated change session status', { sessionId, status })
  
  return metadata
}

/**
 * Add error to change session
 */
export async function addChangeSessionError(
  sessionId: string,
  step: string,
  message: string
): Promise<void> {
  const metadata = await loadChangeSession(sessionId)
  
  if (!metadata) {
    log.error('Cannot add error: session not found', { sessionId })
    return
  }

  metadata.errors.push({
    step,
    message,
    timestamp: new Date().toISOString()
  })

  await saveChangeSession(metadata)
  
  log.warn('Added error to change session', { sessionId, step, message })
}

/**
 * List all change sessions
 */
export async function listChangeSessions(): Promise<ChangeSessionMetadata[]> {
  if (!existsSync(tempRoot)) {
    return []
  }

  try {
    const entries = await readdir(tempRoot, { withFileTypes: true })
    const sessions: ChangeSessionMetadata[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const metadataPath = getChangeMetadataPath(entry.name)
      if (existsSync(metadataPath)) {
        try {
          const content = await readFile(metadataPath, 'utf8')
          const metadata = JSON.parse(content) as ChangeSessionMetadata
          sessions.push(metadata)
        } catch (error) {
          log.warn('Failed to read change session', { 
            sessionId: entry.name, 
            error 
          })
        }
      }
    }

    log.debug('Listed change sessions', { count: sessions.length })
    
    return sessions.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  } catch (error) {
    log.error('Failed to list change sessions', { error })
    return []
  }
}

/**
 * Delete change session
 */
export async function deleteChangeSession(sessionId: string): Promise<boolean> {
  const sessionPath = join(tempRoot, sanitizeSegment(sessionId))
  
  if (!existsSync(sessionPath)) {
    log.warn('Change session not found for deletion', { sessionId, sessionPath })
    return false
  }

  try {
    await rm(sessionPath, { recursive: true, force: true })
    log.info('Deleted change session', { sessionId, sessionPath })
    return true
  } catch (error) {
    log.error('Failed to delete change session', { sessionId, sessionPath, error })
    return false
  }
}

/**
 * Check if a change session exists
 */
export function changeSessionExists(sessionId: string): boolean {
  return existsSync(getChangeMetadataPath(sessionId))
}

/**
 * Save file to change session
 */
export async function saveChangeFile(
  sessionId: string,
  relativePath: string,
  content: string
): Promise<string> {
  const basePath = getChangeOriginalFilesPath(sessionId)
  const filePath = join(basePath, relativePath)
  const directory = join(basePath, relativePath.split('/').slice(0, -1).join('/'))

  await mkdir(directory, { recursive: true })
  await writeFile(filePath, content, 'utf8')

  log.debug('Saved change file', { sessionId, relativePath, filePath })
  
  return filePath
}

/**
 * Read file from change session
 */
export async function readChangeFile(
  sessionId: string,
  relativePath: string
): Promise<string | null> {
  const basePath = getChangeOriginalFilesPath(sessionId)
  const filePath = join(basePath, relativePath)

  if (!existsSync(filePath)) {
    log.debug('Change file not found', { sessionId, relativePath, filePath })
    return null
  }

  try {
    const content = await readFile(filePath, 'utf8')
    log.debug('Read change file', { sessionId, relativePath })
    return content
  } catch (error) {
    log.error('Failed to read change file', { sessionId, relativePath, error })
    return null
  }
}

/**
 * Save delta to change session
 */
export async function saveDelta(
  sessionId: string,
  locale: string,
  type: 'global' | 'page',
  relativePath: string,
  delta: any
): Promise<string> {
  const basePath = getChangeDeltaPath(sessionId, locale)
  const filePath = join(basePath, type, relativePath)
  const directory = join(basePath, type, relativePath.split('/').slice(0, -1).join('/'))

  await mkdir(directory, { recursive: true })
  await writeFile(filePath, JSON.stringify(delta, null, 2), 'utf8')

  log.debug('Saved delta', { sessionId, locale, type, relativePath, filePath })
  
  return filePath
}

/**
 * Read delta from change session
 */
export async function readDelta(
  sessionId: string,
  locale: string,
  type: 'global' | 'page',
  relativePath: string
): Promise<any | null> {
  const basePath = getChangeDeltaPath(sessionId, locale)
  const filePath = join(basePath, type, relativePath)

  if (!existsSync(filePath)) {
    log.debug('Delta not found', { sessionId, locale, type, relativePath })
    return null
  }

  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    log.error('Failed to read delta', { sessionId, locale, type, relativePath, error })
    return null
  }
}
