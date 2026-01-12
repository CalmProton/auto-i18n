/**
 * Batch Common Utilities
 * Shared logic used by all batch providers
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SUPPORTED_LOCALES } from '../../config/locales'
import {
  readBatchFile,
  sanitizeBatchSegment,
  writeBatchFile
} from '../../utils/batchStorage'
import { createScopedLogger } from '../../utils/logger'
import type {
  BatchManifest,
  BatchSourceFile,
  BatchTranslationType,
  BatchRequestFormat
} from './types'

const log = createScopedLogger('batch:common')

const MANIFEST_FILE_NAME = 'manifest.json'

// ============================================================================
// Source File Collection
// ============================================================================

/**
 * Recursively collect markdown files from a content directory
 */
export async function collectContentSources(
  directory: string,
  relativeFolder = ''
): Promise<BatchSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const collected: BatchSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectContentSources(entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const fileStat = await stat(entryPath)
      const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      collected.push({
        type: 'content',
        format: 'markdown',
        folderPath: relativeFolder || undefined,
        filePath: entryPath,
        relativePath,
        fileName: entry.name,
        size: fileStat.size
      })
    }
  }

  return collected
}

/**
 * Recursively collect JSON files from a directory
 */
export async function collectJsonSources(
  type: Extract<BatchTranslationType, 'global' | 'page'>,
  directory: string,
  relativeFolder = ''
): Promise<BatchSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const collected: BatchSourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nextRelative = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      const nested = await collectJsonSources(type, entryPath, nextRelative)
      collected.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      const fileStat = await stat(entryPath)
      const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      collected.push({
        type,
        format: 'json',
        folderPath: relativeFolder || undefined,
        filePath: entryPath,
        relativePath,
        fileName: entry.name,
        size: fileStat.size
      })
    }
  }

  return collected
}

// ============================================================================
// Locale Helpers
// ============================================================================

/**
 * Get target locales from source locale and requested targets
 */
export function getTargetLocales(sourceLocale: string, requested?: string[] | 'all'): string[] {
  const supported = new Set(SUPPORTED_LOCALES.map((locale) => locale.code))
  
  if (!supported.has(sourceLocale)) {
    throw new Error(`Source locale "${sourceLocale}" is not supported`)
  }
  
  const allTargets = Array.from(supported)
    .filter((code) => code !== sourceLocale)
    .sort()
  
  if (!requested || requested === 'all') {
    return allTargets
  }
  
  if (requested.length === 0) {
    return allTargets
  }
  
  const normalized = requested.filter((code) => supported.has(code))
  const targets = normalized.filter((code) => code !== sourceLocale)
  
  if (targets.length === 0) {
    throw new Error('No valid target locales provided')
  }
  
  return Array.from(new Set(targets)).sort()
}

// ============================================================================
// File Filtering
// ============================================================================

/**
 * Normalize a file descriptor path
 */
export function normalizeDescriptor(value: string): string {
  return value.replace(/\\+/g, '/').replace(/^\/+/, '').trim()
}

/**
 * Check if a file should be included in the batch
 */
export function shouldIncludeFile(
  type: BatchTranslationType,
  relativePath: string,
  includeFiles?: string[] | 'all'
): boolean {
  if (!includeFiles || includeFiles === 'all' || includeFiles.length === 0) {
    return true
  }
  
  const normalizedRelative = normalizeDescriptor(relativePath)
  const candidates = new Set([
    normalizedRelative,
    `${type}/${normalizedRelative}`,
    `${type}:${normalizedRelative}`
  ])

  return includeFiles.some((entry) => {
    const trimmed = typeof entry === 'string' ? entry.trim() : String(entry)
    if (candidates.has(trimmed)) {
      return true
    }
    return candidates.has(normalizeDescriptor(trimmed))
  })
}

// ============================================================================
// Custom ID Generation
// ============================================================================

/**
 * Build a unique custom ID for a batch request
 */
export function buildCustomId(
  senderId: string,
  targetLocale: string,
  type: BatchTranslationType,
  relativePath: string,
  format: BatchRequestFormat
): string {
  const hash = createHash('sha1')
    .update(senderId)
    .update('\0')
    .update(targetLocale)
    .update('\0')
    .update(type)
    .update(relativePath)
    .digest('hex')
    .slice(0, 16)
  const pathFragment = sanitizeBatchSegment(relativePath.replace(/\//g, '_')).slice(-24)
  return `${format}_${type}_${targetLocale}_${hash}_${pathFragment}`
}

/**
 * Parse a custom ID to extract metadata
 */
export function parseCustomId(customId: string): {
  format: BatchRequestFormat
  type: string
  targetLocale: string
  hash: string
  pathFragment: string
} | null {
  const parts = customId.split('_')

  if (parts.length < 5) {
    log.warn('Invalid custom_id format', { customId })
    return null
  }

  const [format, type, targetLocale, hash, ...pathFragments] = parts

  if (!['markdown', 'json'].includes(format)) {
    log.warn('Invalid format in custom_id', { customId, format })
    return null
  }

  return {
    format: format as BatchRequestFormat,
    type,
    targetLocale,
    hash,
    pathFragment: pathFragments.join('_')
  }
}

// ============================================================================
// Manifest Management
// ============================================================================

/**
 * Load a batch manifest from storage
 */
export function loadManifest(senderId: string, batchId: string): BatchManifest {
  const content = readBatchFile(senderId, batchId, MANIFEST_FILE_NAME)
  const manifest = JSON.parse(content) as BatchManifest
  return manifest
}

/**
 * Save a batch manifest to storage
 */
export function saveManifest(senderId: string, batchId: string, manifest: BatchManifest): void {
  const updated: BatchManifest = {
    ...manifest,
    updatedAt: new Date().toISOString()
  }
  writeBatchFile(senderId, batchId, MANIFEST_FILE_NAME, JSON.stringify(updated, null, 2))
}

// ============================================================================
// Batch ID Generation
// ============================================================================

/**
 * Generate a batch ID for OpenAI
 */
export function generateOpenAIBatchId(sourceLocale: string): string {
  return `batch_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`
}

/**
 * Generate a batch ID for Anthropic
 */
export function generateAnthropicBatchId(sourceLocale: string): string {
  return `batch_anthropic_${sanitizeBatchSegment(sourceLocale)}_${Date.now()}_${randomUUID().slice(0, 8)}`
}

// ============================================================================
// Unicode Handling
// ============================================================================

/**
 * Decode Unicode escape sequences to proper UTF-8
 */
export function decodeUnicodeEscapes(text: string): string {
  try {
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16))
    })
  } catch (error) {
    log.warn('Failed to decode Unicode escapes', { error, textPreview: text.slice(0, 100) })
    return text
  }
}
