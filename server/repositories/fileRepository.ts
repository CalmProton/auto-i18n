/**
 * File Repository
 * Handles CRUD operations for files (uploads, translations, deltas)
 * Replaces file-based storage in tmp/<senderId>/uploads/, translations/, deltas/
 */
import { getDatabase } from '../database/connection'
import { createScopedLogger } from '../utils/logger'
import { createHash } from 'crypto'

const log = createScopedLogger('repository:file')

// ============================================================================
// TYPES
// ============================================================================

export type FileType = 'upload' | 'translation' | 'delta' | 'original'
export type ContentType = 'content' | 'global' | 'page'
export type FileFormat = 'markdown' | 'json'

export interface TranslationFile {
  id: string
  sessionId: string
  jobId?: string
  
  // File classification
  fileType: FileType
  contentType: ContentType
  format: FileFormat
  
  // File location
  locale: string
  relativePath: string
  fileName: string
  
  // Content
  content: string
  contentHash?: string
  fileSize?: number
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
  
  // Metadata
  metadata: Record<string, unknown>
}

export interface CreateFileInput {
  sessionId: string
  jobId?: string
  fileType: FileType
  contentType: ContentType
  format: FileFormat
  locale: string
  relativePath: string
  fileName: string
  content: string
  metadata?: Record<string, unknown>
}

export interface UpdateFileInput {
  content?: string
  metadata?: Record<string, unknown>
}

export interface FileFilter {
  sessionId?: string
  jobId?: string
  fileType?: FileType
  contentType?: ContentType
  locale?: string
  limit?: number
  offset?: number
}

export interface FileStats {
  totalCount: number
  byType: Record<FileType, number>
  byContentType: Record<ContentType, number>
  byLocale: Record<string, number>
  totalSize: number
}

// ============================================================================
// HELPERS
// ============================================================================

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function detectFormat(fileName: string): FileFormat {
  if (fileName.endsWith('.md') || fileName.endsWith('.mdx')) {
    return 'markdown'
  }
  return 'json'
}

// ============================================================================
// MAPPER
// ============================================================================

function mapRowToFile(row: Record<string, unknown>): TranslationFile {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    jobId: row.job_id as string | undefined,
    fileType: row.file_type as FileType,
    contentType: row.content_type as ContentType,
    format: row.format as FileFormat,
    locale: row.locale as string,
    relativePath: row.relative_path as string,
    fileName: row.file_name as string,
    content: row.content as string,
    contentHash: row.content_hash as string | undefined,
    fileSize: row.file_size as number | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    metadata: (row.metadata as Record<string, unknown>) || {},
  }
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

/**
 * Create a new file
 */
export async function createFile(input: CreateFileInput): Promise<TranslationFile> {
  const db = getDatabase()
  
  const contentHash = computeHash(input.content)
  const fileSize = Buffer.byteLength(input.content, 'utf8')
  const format = input.format || detectFormat(input.fileName)
  
  const rows = await db`
    INSERT INTO files (
      session_id,
      job_id,
      file_type,
      content_type,
      format,
      locale,
      relative_path,
      file_name,
      content,
      content_hash,
      file_size,
      metadata
    ) VALUES (
      ${input.sessionId},
      ${input.jobId || null},
      ${input.fileType},
      ${input.contentType},
      ${format},
      ${input.locale},
      ${input.relativePath},
      ${input.fileName},
      ${input.content},
      ${contentHash},
      ${fileSize},
      ${JSON.stringify(input.metadata || {})}
    )
    RETURNING *
  `
  
  const file = mapRowToFile(rows[0])
  log.debug('Created file', { 
    sessionId: file.sessionId, 
    fileType: file.fileType,
    locale: file.locale, 
    path: file.relativePath 
  })
  
  return file
}

/**
 * Create or update a file (upsert)
 */
export async function upsertFile(input: CreateFileInput): Promise<TranslationFile> {
  const db = getDatabase()
  
  const contentHash = computeHash(input.content)
  const fileSize = Buffer.byteLength(input.content, 'utf8')
  const format = input.format || detectFormat(input.fileName)
  
  const rows = await db`
    INSERT INTO files (
      session_id,
      job_id,
      file_type,
      content_type,
      format,
      locale,
      relative_path,
      file_name,
      content,
      content_hash,
      file_size,
      metadata
    ) VALUES (
      ${input.sessionId},
      ${input.jobId || null},
      ${input.fileType},
      ${input.contentType},
      ${format},
      ${input.locale},
      ${input.relativePath},
      ${input.fileName},
      ${input.content},
      ${contentHash},
      ${fileSize},
      ${JSON.stringify(input.metadata || {})}
    )
    ON CONFLICT (session_id, file_type, locale, relative_path)
    DO UPDATE SET
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      file_size = EXCLUDED.file_size,
      metadata = EXCLUDED.metadata,
      job_id = COALESCE(EXCLUDED.job_id, files.job_id)
    RETURNING *
  `
  
  return mapRowToFile(rows[0])
}

/**
 * Get a file by ID
 */
export async function getFileById(id: string): Promise<TranslationFile | null> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT * FROM files WHERE id = ${id}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToFile(rows[0])
}

/**
 * Get a file by session, type, locale, and path
 */
export async function getFile(
  sessionId: string,
  fileType: FileType,
  locale: string,
  relativePath: string
): Promise<TranslationFile | null> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT * FROM files 
    WHERE session_id = ${sessionId}
    AND file_type = ${fileType}
    AND locale = ${locale}
    AND relative_path = ${relativePath}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToFile(rows[0])
}

/**
 * Update a file
 */
export async function updateFile(id: string, input: UpdateFileInput): Promise<TranslationFile | null> {
  const db = getDatabase()
  
  let contentHash: string | undefined
  let fileSize: number | undefined
  
  if (input.content !== undefined) {
    contentHash = computeHash(input.content)
    fileSize = Buffer.byteLength(input.content, 'utf8')
  }
  
  const rows = await db`
    UPDATE files 
    SET 
      content = COALESCE(${input.content || null}, content),
      content_hash = COALESCE(${contentHash || null}, content_hash),
      file_size = COALESCE(${fileSize || null}, file_size),
      metadata = COALESCE(${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb, metadata)
    WHERE id = ${id}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToFile(rows[0])
}

/**
 * Delete a file by ID
 */
export async function deleteFile(id: string): Promise<boolean> {
  const db = getDatabase()
  
  const result = await db`
    DELETE FROM files WHERE id = ${id}
    RETURNING id
  `
  
  return result.length > 0
}

/**
 * Delete files by session
 */
export async function deleteFilesBySession(sessionId: string, fileType?: FileType): Promise<number> {
  const db = getDatabase()
  
  let result: Record<string, unknown>[]
  
  if (fileType) {
    result = await db`
      DELETE FROM files 
      WHERE session_id = ${sessionId}
      AND file_type = ${fileType}
      RETURNING id
    `
  } else {
    result = await db`
      DELETE FROM files 
      WHERE session_id = ${sessionId}
      RETURNING id
    `
  }
  
  if (result.length > 0) {
    log.info('Deleted files', { sessionId, fileType, count: result.length })
  }
  
  return result.length
}

/**
 * List files with filtering
 */
export async function listFiles(filter: FileFilter = {}): Promise<TranslationFile[]> {
  const db = getDatabase()
  const limit = filter.limit || 100
  const offset = filter.offset || 0
  
  let rows: Record<string, unknown>[]
  
  if (filter.sessionId && filter.fileType && filter.locale) {
    rows = await db`
      SELECT * FROM files 
      WHERE session_id = ${filter.sessionId}
      AND file_type = ${filter.fileType}
      AND locale = ${filter.locale}
      ORDER BY relative_path ASC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId && filter.fileType) {
    rows = await db`
      SELECT * FROM files 
      WHERE session_id = ${filter.sessionId}
      AND file_type = ${filter.fileType}
      ORDER BY locale, relative_path ASC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId && filter.locale) {
    rows = await db`
      SELECT * FROM files 
      WHERE session_id = ${filter.sessionId}
      AND locale = ${filter.locale}
      ORDER BY file_type, relative_path ASC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId) {
    rows = await db`
      SELECT * FROM files 
      WHERE session_id = ${filter.sessionId}
      ORDER BY file_type, locale, relative_path ASC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.contentType) {
    rows = await db`
      SELECT * FROM files 
      WHERE content_type = ${filter.contentType}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await db`
      SELECT * FROM files 
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  
  return rows.map(mapRowToFile)
}

/**
 * Get files for a session organized by locale and content type
 */
export async function getFilesBySessionGrouped(
  sessionId: string,
  fileType: FileType
): Promise<Map<string, Map<ContentType, TranslationFile[]>>> {
  const files = await listFiles({ sessionId, fileType, limit: 10000 })
  
  const grouped = new Map<string, Map<ContentType, TranslationFile[]>>()
  
  for (const file of files) {
    if (!grouped.has(file.locale)) {
      grouped.set(file.locale, new Map())
    }
    const localeMap = grouped.get(file.locale)!
    if (!localeMap.has(file.contentType)) {
      localeMap.set(file.contentType, [])
    }
    localeMap.get(file.contentType)!.push(file)
  }
  
  return grouped
}

/**
 * Get upload files for a session
 */
export async function getUploadFiles(sessionId: string, locale?: string): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'upload', locale, limit: 10000 })
}

/**
 * Get translation files for a session
 */
export async function getTranslationFiles(sessionId: string, locale?: string): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'translation', locale, limit: 10000 })
}

/**
 * Get delta files for a session
 */
export async function getDeltaFiles(sessionId: string, locale?: string): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'delta', locale, limit: 10000 })
}

/**
 * Get original files for a session (used in changes workflow)
 */
export async function getOriginalFiles(sessionId: string, locale?: string): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'original', locale, limit: 10000 })
}

/**
 * Count files with filtering
 */
export async function countFiles(filter: FileFilter = {}): Promise<number> {
  const db = getDatabase()
  
  let result: { count: string }[]
  
  if (filter.sessionId && filter.fileType) {
    result = await db`
      SELECT COUNT(*) as count FROM files 
      WHERE session_id = ${filter.sessionId}
      AND file_type = ${filter.fileType}
    `
  } else if (filter.sessionId) {
    result = await db`
      SELECT COUNT(*) as count FROM files 
      WHERE session_id = ${filter.sessionId}
    `
  } else if (filter.fileType) {
    result = await db`
      SELECT COUNT(*) as count FROM files 
      WHERE file_type = ${filter.fileType}
    `
  } else {
    result = await db`SELECT COUNT(*) as count FROM files`
  }
  
  return parseInt(result[0].count, 10)
}

/**
 * Get file statistics for a session
 */
export async function getFileStats(sessionId: string): Promise<FileStats> {
  const db = getDatabase()
  
  const countByType = await db`
    SELECT file_type, COUNT(*) as count
    FROM files
    WHERE session_id = ${sessionId}
    GROUP BY file_type
  ` as { file_type: FileType; count: string }[]
  
  const countByContentType = await db`
    SELECT content_type, COUNT(*) as count
    FROM files
    WHERE session_id = ${sessionId}
    GROUP BY content_type
  ` as { content_type: ContentType; count: string }[]
  
  const countByLocale = await db`
    SELECT locale, COUNT(*) as count
    FROM files
    WHERE session_id = ${sessionId}
    GROUP BY locale
  ` as { locale: string; count: string }[]
  
  const totals = await db`
    SELECT 
      COUNT(*) as total_count,
      COALESCE(SUM(file_size), 0) as total_size
    FROM files
    WHERE session_id = ${sessionId}
  ` as { total_count: string; total_size: string }[]
  
  const byType: Record<FileType, number> = {
    upload: 0,
    translation: 0,
    delta: 0,
    original: 0,
  }
  for (const row of countByType) {
    byType[row.file_type] = parseInt(row.count, 10)
  }
  
  const byContentType: Record<ContentType, number> = {
    content: 0,
    global: 0,
    page: 0,
  }
  for (const row of countByContentType) {
    byContentType[row.content_type] = parseInt(row.count, 10)
  }
  
  const byLocale: Record<string, number> = {}
  for (const row of countByLocale) {
    byLocale[row.locale] = parseInt(row.count, 10)
  }
  
  return {
    totalCount: parseInt(totals[0].total_count, 10),
    byType,
    byContentType,
    byLocale,
    totalSize: parseInt(totals[0].total_size, 10),
  }
}

/**
 * Check if content has changed (by hash)
 */
export async function hasContentChanged(
  sessionId: string,
  fileType: FileType,
  locale: string,
  relativePath: string,
  newContent: string
): Promise<boolean> {
  const existing = await getFile(sessionId, fileType, locale, relativePath)
  
  if (!existing) {
    return true // New file
  }
  
  const newHash = computeHash(newContent)
  return existing.contentHash !== newHash
}

/**
 * Bulk create files
 */
export async function bulkCreateFiles(inputs: CreateFileInput[]): Promise<TranslationFile[]> {
  if (inputs.length === 0) {
    return []
  }
  
  const results: TranslationFile[] = []
  
  // Process in batches of 100
  const batchSize = 100
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize)
    
    // Use upsert for each file
    const promises = batch.map(input => upsertFile(input))
    const files = await Promise.all(promises)
    results.push(...files)
  }
  
  log.info('Bulk created files', { count: results.length })
  return results
}

/**
 * Get locales with files for a session
 */
export async function getLocalesForSession(sessionId: string, fileType?: FileType): Promise<string[]> {
  const db = getDatabase()
  
  let rows: { locale: string }[]
  
  if (fileType) {
    rows = await db`
      SELECT DISTINCT locale FROM files
      WHERE session_id = ${sessionId}
      AND file_type = ${fileType}
      ORDER BY locale
    `
  } else {
    rows = await db`
      SELECT DISTINCT locale FROM files
      WHERE session_id = ${sessionId}
      ORDER BY locale
    `
  }
  
  return rows.map(r => r.locale)
}
