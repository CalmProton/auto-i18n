import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { 
  ChangesUploadRequest, 
  ChangeSessionMetadata, 
  FileChange,
  JsonDelta,
  MarkdownDelta,
  TranslationFileType
} from '../types'
import { createScopedLogger } from '../utils/logger'
import { 
  saveChangeSession, 
  saveChangeFile,
  saveDelta,
  getChangeOriginalFilesPath 
} from '../utils/changeStorage'
import { extractJsonDelta, extractMarkdownDelta, parseJsonSafe, isDeltaEmpty } from '../utils/deltaExtractor'
import { GitHubClient } from './github/client'

const log = createScopedLogger('services:changeProcessor')

interface ProcessedChange extends FileChange {
  hasDelta?: boolean
  deltaPath?: string
  originalPath: string
}

/**
 * Process uploaded changes and extract deltas for JSON files
 */
export async function processChanges(
  request: ChangesUploadRequest,
  files: Map<string, File>
): Promise<ChangeSessionMetadata> {
  log.info('Processing changes', {
    sessionId: request.sessionId,
    changeCount: request.changes.length,
    filesCount: files.size,
    automationMode: request.automationMode
  })

  const timestamp = new Date().toISOString()
  const processedChanges: ProcessedChange[] = []

  // Create initial metadata
  const metadata: ChangeSessionMetadata = {
    sessionId: request.sessionId,
    status: 'uploaded',
    repository: {
      owner: request.repository.owner,
      name: request.repository.name,
      baseBranch: request.repository.baseBranch,
      baseCommitSha: request.repository.baseCommitSha,
      commitSha: request.repository.commitSha
    },
    commit: {
      sha: request.repository.commitSha,
      shortSha: request.repository.commitSha.substring(0, 7),
      message: request.repository.commitMessage,
      author: request.repository.commitAuthor,
      timestamp
    },
    sourceLocale: request.sourceLocale,
    targetLocales: request.targetLocales,
    changes: [],
    automationMode: request.automationMode || 'manual',
    steps: {
      uploaded: { completed: true, timestamp },
      batchCreated: { completed: false },
      submitted: { completed: false },
      processing: { completed: false },
      completed: { completed: false },
      prCreated: { completed: false }
    },
    errors: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }

  // Ensure directory structure exists
  const basePath = getChangeOriginalFilesPath(request.sessionId)
  await mkdir(basePath, { recursive: true })

  // Process each change
  for (const change of request.changes) {
    try {
      // Try to find the file - first by exact path, then by sanitized path
      let file = files.get(change.path)
      
      // If not found, try sanitized version (workflow sanitizes paths for form field names)
      if (!file && change.changeType !== 'deleted') {
        const sanitizedPath = change.path
          .replace(/\//g, '_')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
        file = files.get(sanitizedPath)
        
        if (file) {
          log.info('Found file using sanitized path', {
            sessionId: request.sessionId,
            originalPath: change.path,
            sanitizedPath
          })
        }
      }
      
      if (!file && change.changeType !== 'deleted') {
        log.warn('File not found for change', { 
          sessionId: request.sessionId, 
          path: change.path,
          availableKeys: Array.from(files.keys())
        })
        continue
      }

      const relativePath = getRelativePath(change.path, change.type, request.sourceLocale)
      
      const processedChange: ProcessedChange = {
        path: change.path,
        type: change.type,
        changeType: change.changeType,
        size: file?.size,
        relativePath,
        originalPath: ''
      }

      // Handle deleted files
      if (change.changeType === 'deleted') {
        log.info('Change marked as deleted', { 
          sessionId: request.sessionId, 
          path: change.path 
        })
        processedChanges.push(processedChange)
        continue
      }

      // Save the file
      if (file) {
        const content = await file.text()
        const savedPath = await saveChangeFile(
          request.sessionId,
          relativePath,
          content
        )
        processedChange.originalPath = savedPath

        // Extract delta for JSON files
        if (change.type === 'global' || change.type === 'page') {
          const delta = await extractDeltaFromFile(
            request.sessionId,
            change,
            content,
            request.repository,
            request.sourceLocale
          )

          if (delta && !isDeltaEmpty(delta)) {
            processedChange.hasDelta = true
            const deltaPath = await saveDelta(
              request.sessionId,
              request.sourceLocale,
              change.type,
              relativePath.replace('.json', '.delta.json'),
              delta
            )
            processedChange.deltaPath = deltaPath
            
            log.info('Extracted delta', {
              sessionId: request.sessionId,
              path: change.path,
              added: Object.keys(delta.added).length,
              modified: Object.keys(delta.modified).length,
              deleted: delta.deleted.length
            })
          } else {
            log.info('No delta detected', {
              sessionId: request.sessionId,
              path: change.path
            })
          }
        }

        // Extract delta for markdown files
        if (change.type === 'content') {
          const delta = await extractMarkdownDeltaFromFile(
            request.sessionId,
            change,
            content,
            request.repository,
            request.sourceLocale
          )

          if (delta && delta.changes.length > 0) {
            processedChange.hasDelta = true
            const deltaPath = await saveDelta(
              request.sessionId,
              request.sourceLocale,
              change.type,
              relativePath.replace(/\.(md|mdx)$/, '.delta.json'),
              delta
            )
            processedChange.deltaPath = deltaPath
            
            log.info('Extracted markdown delta', {
              sessionId: request.sessionId,
              path: change.path,
              changes: delta.changes.length,
              added: delta.changes.filter((c: any) => c.type === 'added').length,
              modified: delta.changes.filter((c: any) => c.type === 'modified').length,
              deleted: delta.changes.filter((c: any) => c.type === 'deleted').length
            })
          } else {
            log.info('No markdown delta detected', {
              sessionId: request.sessionId,
              path: change.path
            })
          }
        }
      }

      processedChanges.push(processedChange)
    } catch (error) {
      log.error('Failed to process change', {
        sessionId: request.sessionId,
        path: change.path,
        error
      })
      
      metadata.errors.push({
        step: 'upload',
        message: `Failed to process ${change.path}: ${error}`,
        timestamp: new Date().toISOString()
      })
    }
  }

  // Update metadata with processed changes
  metadata.changes = processedChanges.map(pc => ({
    path: pc.path,
    type: pc.type,
    changeType: pc.changeType,
    size: pc.size,
    relativePath: pc.relativePath
  }))

  await saveChangeSession(metadata)

  log.info('Changes processed', {
    sessionId: request.sessionId,
    processedCount: processedChanges.length,
    withDeltas: processedChanges.filter(c => c.hasDelta).length
  })

  return metadata
}

/**
 * Extract delta by comparing with previous version from GitHub
 */
async function extractDeltaFromFile(
  sessionId: string,
  change: FileChange,
  newContent: string,
  repository: ChangesUploadRequest['repository'],
  sourceLocale: string
): Promise<JsonDelta | null> {
  try {
    // Parse new content
    const newJson = parseJsonSafe(newContent)
    if (!newJson) {
      log.warn('Failed to parse new JSON content', { 
        sessionId, 
        path: change.path 
      })
      return null
    }

    // For added files, all keys are new
    if (change.changeType === 'added') {
      return {
        added: newJson,
        modified: {},
        deleted: []
      }
    }

    // For modified files, fetch old version from GitHub
    const client = new GitHubClient()

    try {
      const oldContent = await client.getFileContent(
        repository.owner,
        repository.name,
        change.path,
        repository.baseCommitSha
      )

      const oldJson = parseJsonSafe(oldContent)
      if (!oldJson) {
        log.warn('Failed to parse old JSON content from GitHub', { 
          sessionId, 
          path: change.path 
        })
        // Treat as all new
        return {
          added: newJson,
          modified: {},
          deleted: []
        }
      }

      // Extract delta
      const delta = extractJsonDelta(oldJson, newJson)
      
      return delta
    } catch (error) {
      log.warn('Failed to fetch old version from GitHub, treating as new', {
        sessionId,
        path: change.path,
        error
      })
      
      // Treat as all new
      return {
        added: newJson,
        modified: {},
        deleted: []
      }
    }
  } catch (error) {
    log.error('Failed to extract delta', { 
      sessionId, 
      path: change.path, 
      error 
    })
    return null
  }
}

/**
 * Extract markdown delta by comparing with previous version from GitHub
 */
async function extractMarkdownDeltaFromFile(
  sessionId: string,
  change: FileChange,
  newContent: string,
  repository: ChangesUploadRequest['repository'],
  sourceLocale: string
): Promise<MarkdownDelta | null> {
  try {
    // For added files, all lines are new
    if (change.changeType === 'added') {
      const lines = newContent.split('\n')
      return {
        changes: lines.map((line, index) => ({
          lineNumber: index + 1,
          oldLine: '',
          newLine: line,
          type: 'added' as const
        }))
      }
    }

    // For modified files, fetch old version from GitHub
    const client = new GitHubClient()

    try {
      const oldContent = await client.getFileContent(
        repository.owner,
        repository.name,
        change.path,
        repository.baseCommitSha
      )

      // Extract delta
      const delta = extractMarkdownDelta(oldContent, newContent)
      
      return delta
    } catch (error) {
      log.warn('Failed to fetch old markdown version from GitHub, treating as new', {
        sessionId,
        path: change.path,
        error
      })
      
      // Treat as all new
      const lines = newContent.split('\n')
      return {
        changes: lines.map((line, index) => ({
          lineNumber: index + 1,
          oldLine: '',
          newLine: line,
          type: 'added' as const
        }))
      }
    }
  } catch (error) {
    log.error('Failed to extract markdown delta', { 
      sessionId, 
      path: change.path, 
      error 
    })
    return null
  }
}

/**
 * Get relative path for storage based on file type
 */
function getRelativePath(
  fullPath: string,
  type: TranslationFileType,
  sourceLocale: string
): string {
  // Remove leading slash
  const normalized = fullPath.replace(/^\/+/, '')

  if (type === 'content') {
    // content/en/docs/guide.md -> docs/guide.md
    const contentPrefix = `content/${sourceLocale}/`
    if (normalized.startsWith(contentPrefix)) {
      return normalized.substring(contentPrefix.length)
    }
    return normalized
  }

  if (type === 'global') {
    // i18n/locales/en.json -> en.json
    return `${sourceLocale}.json`
  }

  if (type === 'page') {
    // i18n/locales/pages/home/en.json -> home/en.json
    const pagesPrefix = 'i18n/locales/pages/'
    if (normalized.startsWith(pagesPrefix)) {
      return normalized.substring(pagesPrefix.length)
    }
    return normalized
  }

  return normalized
}
