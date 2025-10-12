/**
 * Dashboard Utilities
 * Helper functions for the dashboard API endpoints
 */

import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Upload,
  Batch,
  TranslationSession,
  GitHubSession,
  FileCount,
  UploadStatus,
  BatchStatus,
  SystemStats,
  FileInfo,
  TranslationFileStatus,
} from '../types/api'
import type { TranslationMetadataFile } from '../types'
import type { BatchManifest } from '../services/translation/openaiBatchService'
import { SUPPORTED_LOCALES } from '../config/locales'
import { getTranslationConfig } from '../config/env'
import { getGitHubConfig } from '../config/github'
import { createScopedLogger } from './logger'
import { readFileSync } from 'node:fs'

const log = createScopedLogger('utils:dashboard')

const TMP_DIR = join(process.cwd(), 'tmp')

/**
 * Helper function to read and parse JSON file
 */
function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    log.error(`Error reading JSON file ${filePath}:`, error)
    return null
  }
}

/**
 * List all sender IDs in the tmp directory
 */
export function listAllSenderIds(): string[] {
  try {
    if (!existsSync(TMP_DIR)) {
      return []
    }

    return readdirSync(TMP_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && dirent.name !== 'logs')
      .map((dirent) => dirent.name)
  } catch (error) {
    log.error('Error listing sender IDs:', error)
    return []
  }
}

/**
 * Count files in a directory by type
 */
function countFilesByType(dir: string): FileCount {
  const count: FileCount = { content: 0, global: 0, page: 0, total: 0 }

  if (!existsSync(dir)) {
    return count
  }

  const types = ['content', 'global', 'page'] as const

  for (const type of types) {
    const typeDir = join(dir, type)
    if (existsSync(typeDir)) {
      const files = readdirSync(typeDir, { withFileTypes: true })
      count[type] = files.filter((f) => f.isFile()).length
      count.total += count[type]
    }
  }

  return count
}

/**
 * Get upload information for a sender
 */
export function getUploadInfo(senderId: string): Upload | null {
  try {
    const senderDir = join(TMP_DIR, senderId)
    if (!existsSync(senderDir)) {
      return null
    }

    const metadataPath = join(senderDir, 'metadata.json')
    const metadata = existsSync(metadataPath)
      ? (readJsonFile<TranslationMetadataFile>(metadataPath) as TranslationMetadataFile)
      : null

    const uploadsDir = join(senderDir, 'uploads')
    const sourceLocale = metadata?.sourceLocale || 'en'
    const sourceDir = join(uploadsDir, sourceLocale)

    // Count files
    const fileCount = countFilesByType(sourceDir)

    // Get target locales
    const targetLocales = metadata?.targetLocales || []

    // Check for batches
    const batchesDir = join(senderDir, 'batches')
    const batchIds = existsSync(batchesDir)
      ? readdirSync(batchesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : []

    // Check for translations
    const translationsDir = join(senderDir, 'translations')
    const hasTranslations = existsSync(translationsDir)

    // Calculate translation progress
    let translationProgress
    if (hasTranslations && targetLocales.length > 0) {
      let completedLocales = 0
      for (const locale of targetLocales) {
        const localeDir = join(translationsDir, locale)
        if (existsSync(localeDir)) {
          const localeCount = countFilesByType(localeDir)
          if (localeCount.total === fileCount.total) {
            completedLocales++
          }
        }
      }
      translationProgress = {
        completed: completedLocales,
        total: targetLocales.length,
        percentage: Math.round((completedLocales / targetLocales.length) * 100),
      }
    }

    // Determine status
    let status: UploadStatus = 'uploaded'
    if (translationProgress && translationProgress.completed === translationProgress.total) {
      status = 'completed'
    } else if (translationProgress && translationProgress.completed > 0) {
      status = 'translating'
    } else if (batchIds.length > 0) {
      status = 'batched'
    }

    // Get timestamps
    const stats = statSync(senderDir)

    return {
      senderId,
      repository: metadata?.repository
        ? { owner: metadata.repository.owner, name: metadata.repository.name }
        : undefined,
      sourceLocale,
      targetLocales,
      fileCount,
      status,
      createdAt: metadata?.createdAt || stats.birthtime.toISOString(),
      updatedAt: metadata?.updatedAt || stats.mtime.toISOString(),
      batchIds,
      hasTranslations,
      translationProgress,
    }
  } catch (error) {
    log.error(`Error getting upload info for ${senderId}:`, error)
    return null
  }
}

/**
 * List all uploads
 */
export function listAllUploads(): Upload[] {
  const senderIds = listAllSenderIds()
  return senderIds.map((id) => getUploadInfo(id)).filter((u): u is Upload => u !== null)
}

/**
 * List all batch IDs across all senders
 */
export function listAllBatchIds(): Array<{ senderId: string; batchId: string }> {
  const senderIds = listAllSenderIds()
  const batches: Array<{ senderId: string; batchId: string }> = []

  for (const senderId of senderIds) {
    const batchesDir = join(TMP_DIR, senderId, 'batches')
    if (!existsSync(batchesDir)) {
      continue
    }

    const batchDirs = readdirSync(batchesDir, { withFileTypes: true }).filter((d) => d.isDirectory())

    for (const dir of batchDirs) {
      batches.push({ senderId, batchId: dir.name })
    }
  }

  return batches
}

/**
 * Get batch information
 */
export function getBatchInfo(senderId: string, batchId: string): Batch | null {
  try {
    const batchDir = join(TMP_DIR, senderId, 'batches', batchId)
    if (!existsSync(batchDir)) {
      return null
    }

    // Read manifest
    const manifestPath = join(batchDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      return null
    }

    const manifest = readJsonFile<BatchManifest>(manifestPath)
    if (!manifest) {
      return null
    }

    // Check for input/output/error files
    const inputPath = join(batchDir, 'batch_input.jsonl')
    const outputPath = join(batchDir, 'batch_output.jsonl')
    const errorPath = join(batchDir, `batch_${manifest.openai?.batchId}_error.jsonl`)

    const hasOutput = existsSync(outputPath)
    const hasErrors = existsSync(errorPath)

    // Count errors if error file exists
    let errorCount = 0
    if (hasErrors) {
      try {
        const errorContent = readFileSync(errorPath, 'utf-8')
        const lines = errorContent.split('\n').filter((l) => l.trim())
        errorCount = lines.length
      } catch {
        // Ignore error
      }
    }

    // Determine output processed status
    const outputProcessed = manifest.status === 'completed' && hasOutput

    // Get repository name from sender metadata
    const metadataPath = join(TMP_DIR, senderId, 'metadata.json')
    const metadata = readJsonFile<TranslationMetadataFile>(metadataPath)
    const repositoryName = metadata?.repository ? `${metadata.repository.owner}/${metadata.repository.name}` : undefined

    // Calculate progress (for OpenAI batches, this would come from API status)
    const progress =
      manifest.status === 'completed'
        ? {
            completed: manifest.totalRequests,
            total: manifest.totalRequests,
            percentage: 100,
            errorCount,
          }
        : undefined

    // Get timestamps
    const stats = statSync(batchDir)

    return {
      batchId,
      senderId,
      repositoryName,
      status: (manifest.status as BatchStatus) || 'pending',
      jobType: 'openai-batch', // Currently only OpenAI batches are supported
      sourceLocale: manifest.sourceLocale,
      targetLocales: manifest.targetLocales,
      types: manifest.types,
      requestCount: manifest.totalRequests,
      errorCount,
      progress,
      openAiBatchId: manifest.openai?.batchId,
      openAiStatus: manifest.openai?.status,
      model: manifest.model,
      provider: 'openai', // Currently only OpenAI batches
      createdAt: stats.birthtime.toISOString(),
      submittedAt: manifest.openai?.submissionTimestamp,
      completedAt: undefined, // TODO: Get from OpenAI status
      hasOutput,
      hasErrors,
      outputProcessed,
    }
  } catch (error) {
    log.error(`Error getting batch info for ${senderId}/${batchId}:`, error)
    return null
  }
}

/**
 * List all batches
 */
export function listAllBatches(): Batch[] {
  const batchIds = listAllBatchIds()
  return batchIds.map(({ senderId, batchId }) => getBatchInfo(senderId, batchId)).filter((b): b is Batch => b !== null)
}

/**
 * Get translation status for a sender
 */
export function getTranslationStatus(senderId: string): TranslationSession | null {
  try {
    const senderDir = join(TMP_DIR, senderId)
    if (!existsSync(senderDir)) {
      return null
    }

    const metadataPath = join(senderDir, 'metadata.json')
    const metadata = existsSync(metadataPath)
      ? (readJsonFile<TranslationMetadataFile>(metadataPath) as TranslationMetadataFile)
      : null

    const sourceLocale = metadata?.sourceLocale || 'en'
    const targetLocales = metadata?.targetLocales || []

    // Get expected file counts from source
    const uploadsDir = join(senderDir, 'uploads', sourceLocale)
    const expectedCounts = countFilesByType(uploadsDir)

    // Get repository name
    const repositoryName = metadata?.repository ? `${metadata.repository.owner}/${metadata.repository.name}` : undefined

    // Check each target locale
    const translationsDir = join(senderDir, 'translations')
    const matrix: Record<string, TranslationFileStatus & { percentage: number }> = {}
    let totalCompleted = 0
    let totalMissing = 0

    for (const locale of targetLocales) {
      const localeDir = join(translationsDir, locale)
      const actualCounts = existsSync(localeDir) ? countFilesByType(localeDir) : { content: 0, global: 0, page: 0, total: 0 }

      const status: TranslationFileStatus = {
        content: { count: actualCounts.content, expected: expectedCounts.content },
        global: { count: actualCounts.global, expected: expectedCounts.global },
        page: { count: actualCounts.page, expected: expectedCounts.page },
      }

      const percentage = expectedCounts.total > 0 ? Math.round((actualCounts.total / expectedCounts.total) * 100) : 0

      matrix[locale] = { ...status, percentage }

      if (actualCounts.total === expectedCounts.total) {
        totalCompleted++
      }

      totalMissing += expectedCounts.total - actualCounts.total
    }

    const totalExpected = targetLocales.length * expectedCounts.total
    const totalActual = Object.values(matrix).reduce((sum, m) => sum + m.content.count + m.global.count + m.page.count, 0)

    return {
      senderId,
      repositoryName,
      sourceLocale,
      targetLocales,
      matrix,
      summary: {
        total: totalExpected,
        completed: totalActual,
        missing: totalMissing,
        percentage: totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0,
      },
      lastUpdated: new Date().toISOString(),
    }
  } catch (error) {
    log.error(`Error getting translation status for ${senderId}:`, error)
    return null
  }
}

/**
 * List all translation sessions
 */
export function listAllTranslationSessions(): TranslationSession[] {
  const senderIds = listAllSenderIds()
  return senderIds
    .map((id) => getTranslationStatus(id))
    .filter((t): t is TranslationSession => t !== null && t.summary.completed > 0)
}

/**
 * Check if a sender is ready for GitHub PR
 */
export function isReadyForGitHub(senderId: string): GitHubSession | null {
  try {
    const translationStatus = getTranslationStatus(senderId)
    if (!translationStatus) {
      return null
    }

    // Check if all locales are fully translated
    const completedLocales = translationStatus.targetLocales.filter((locale) => {
      const status = translationStatus.matrix[locale]
      return status.percentage === 100
    })

    // Must have at least one completed locale
    if (completedLocales.length === 0) {
      return null
    }

    // Get metadata
    const metadataPath = join(TMP_DIR, senderId, 'metadata.json')
    const metadata = existsSync(metadataPath)
      ? (readJsonFile<TranslationMetadataFile>(metadataPath) as TranslationMetadataFile)
      : null

    if (!metadata?.repository) {
      return null
    }

    // Get upload info for file counts
    const uploadInfo = getUploadInfo(senderId)
    if (!uploadInfo) {
      return null
    }

    return {
      senderId,
      repositoryName: `${metadata.repository.owner}/${metadata.repository.name}`,
      repository: {
        owner: metadata.repository.owner,
        name: metadata.repository.name,
        baseBranch: metadata.repository.baseBranch,
      },
      sourceLocale: translationStatus.sourceLocale,
      availableLocales: translationStatus.targetLocales,
      completedLocales,
      fileCount: uploadInfo.fileCount,
      hasPullRequest: false, // TODO: Track PR creation status
      pullRequestNumber: undefined,
      pullRequestUrl: undefined,
    }
  } catch (error) {
    log.error(`Error checking GitHub readiness for ${senderId}:`, error)
    return null
  }
}

/**
 * List sessions ready for GitHub PR
 */
export function listReadyForGitHub(): GitHubSession[] {
  const senderIds = listAllSenderIds()
  return senderIds.map((id) => isReadyForGitHub(id)).filter((s): s is GitHubSession => s !== null)
}

/**
 * Get system statistics
 */
export function getSystemStats(): SystemStats {
  const uploads = listAllUploads()
  const batches = listAllBatches()

  // Calculate tmp directory size
  let tmpSize = 0
  try {
    const calculateDirSize = (dir: string): number => {
      if (!existsSync(dir)) return 0
      let size = 0
      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const fullPath = join(dir, item.name)
        if (item.isDirectory()) {
          size += calculateDirSize(fullPath)
        } else {
          size += statSync(fullPath).size
        }
      }
      return size
    }
    tmpSize = calculateDirSize(TMP_DIR)
  } catch (error) {
    log.error('Error calculating tmp directory size:', error)
  }

  // Get provider configurations
  const translationConfig = getTranslationConfig()
  
  // Get GitHub configuration
  let githubConfigured = false
  let githubApiUrl = 'https://api.github.com'
  try {
    const ghConfig = getGitHubConfig()
    githubConfigured = !!ghConfig.token
    githubApiUrl = ghConfig.apiBaseUrl
  } catch {
    // GitHub not configured
  }

  return {
    tmpDirectory: {
      size: tmpSize,
      uploadCount: uploads.length,
      batchCount: batches.length,
      translationCount: uploads.filter((u) => u.hasTranslations).length,
    },
    providers: {
      openai: {
        configured: !!translationConfig.providers.openai?.apiKey,
        model: translationConfig.providers.openai?.model || 'gpt-4-mini',
      },
      anthropic: {
        configured: !!translationConfig.providers.anthropic?.apiKey,
        model: translationConfig.providers.anthropic?.model || 'claude-3-haiku-20240307',
      },
      deepseek: {
        configured: !!translationConfig.providers.deepseek?.apiKey,
        model: translationConfig.providers.deepseek?.model || 'deepseek-chat',
      },
    },
    github: {
      configured: githubConfigured,
      apiUrl: githubApiUrl,
    },
  }
}

/**
 * Delete an upload session and all associated data
 */
export function deleteUploadSession(senderId: string): void {
  const senderDir = join(TMP_DIR, senderId)
  if (existsSync(senderDir)) {
    rmSync(senderDir, { recursive: true, force: true })
  }
}

/**
 * Delete a batch
 */
export function deleteBatch(senderId: string, batchId: string): void {
  const batchDir = join(TMP_DIR, senderId, 'batches', batchId)
  if (existsSync(batchDir)) {
    rmSync(batchDir, { recursive: true, force: true })
  }
}

/**
 * List files in a directory
 */
export function listFiles(dir: string): FileInfo[] {
  if (!existsSync(dir)) {
    return []
  }

  try {
    const files = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile())

    return files.map((file) => {
      const filePath = join(dir, file.name)
      const stats = statSync(filePath)
      return {
        name: file.name,
        size: stats.size,
        path: filePath,
        lastModified: stats.mtime.toISOString(),
      }
    })
  } catch (error) {
    log.error(`Error listing files in ${dir}:`, error)
    return []
  }
}
