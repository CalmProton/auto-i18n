/**
 * File Repository
 * Handles CRUD operations for files (uploads, translations, deltas) using Drizzle ORM
 */
import { eq, and, desc, asc, sql } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { files } from '../database/schema'
import type { File, NewFile, FileType, ContentType, FileFormat } from '../database/schema'
import { createScopedLogger } from '../utils/logger'
import { createHash } from 'crypto'

const log = createScopedLogger('repository:file')

// ============================================================================
// TYPES
// ============================================================================

// Re-export schema types with aliases for compatibility
export type TranslationFile = File
export type { FileType, ContentType, FileFormat }

export interface CreateFileInput {
  sessionId: string
  jobId?: string
  fileType: FileType
  contentType: ContentType
  format?: FileFormat
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

  const [file] = await db
    .insert(files)
    .values({
      sessionId: input.sessionId,
      jobId: input.jobId,
      fileType: input.fileType,
      contentType: input.contentType,
      format,
      locale: input.locale,
      relativePath: input.relativePath,
      fileName: input.fileName,
      content: input.content,
      contentHash,
      fileSize,
      metadata: input.metadata || {},
    })
    .returning()

  log.debug('Created file', {
    sessionId: file.sessionId,
    fileType: file.fileType,
    locale: file.locale,
    path: file.relativePath,
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

  const [file] = await db
    .insert(files)
    .values({
      sessionId: input.sessionId,
      jobId: input.jobId,
      fileType: input.fileType,
      contentType: input.contentType,
      format,
      locale: input.locale,
      relativePath: input.relativePath,
      fileName: input.fileName,
      content: input.content,
      contentHash,
      fileSize,
      metadata: input.metadata || {},
    })
    .onConflictDoUpdate({
      target: [files.sessionId, files.fileType, files.locale, files.relativePath],
      set: {
        content: sql`EXCLUDED.content`,
        contentHash: sql`EXCLUDED.content_hash`,
        fileSize: sql`EXCLUDED.file_size`,
        metadata: sql`EXCLUDED.metadata`,
        jobId: sql`COALESCE(EXCLUDED.job_id, ${files.jobId})`,
      },
    })
    .returning()

  return file
}

/**
 * Get a file by ID
 */
export async function getFileById(id: string): Promise<TranslationFile | null> {
  const db = getDatabase()

  const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1)

  return file || null
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

  const [file] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.sessionId, sessionId),
        eq(files.fileType, fileType),
        eq(files.locale, locale),
        eq(files.relativePath, relativePath)
      )
    )
    .limit(1)

  return file || null
}

/**
 * Update a file
 */
export async function updateFile(
  id: string,
  input: UpdateFileInput
): Promise<TranslationFile | null> {
  const db = getDatabase()

  const updateData: Partial<NewFile> = {}

  if (input.content !== undefined) {
    updateData.content = input.content
    updateData.contentHash = computeHash(input.content)
    updateData.fileSize = Buffer.byteLength(input.content, 'utf8')
  }

  if (input.metadata !== undefined) {
    updateData.metadata = input.metadata
  }

  const [file] = await db
    .update(files)
    .set(updateData)
    .where(eq(files.id, id))
    .returning()

  return file || null
}

/**
 * Delete a file by ID
 */
export async function deleteFile(id: string): Promise<boolean> {
  const db = getDatabase()

  const result = await db.delete(files).where(eq(files.id, id)).returning({ id: files.id })

  return result.length > 0
}

/**
 * Delete files by session
 */
export async function deleteFilesBySession(
  sessionId: string,
  fileType?: FileType
): Promise<number> {
  const db = getDatabase()

  const conditions = [eq(files.sessionId, sessionId)]
  if (fileType) {
    conditions.push(eq(files.fileType, fileType))
  }

  const result = await db
    .delete(files)
    .where(and(...conditions))
    .returning({ id: files.id })

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

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(files.sessionId, filter.sessionId))
  }
  if (filter.fileType) {
    conditions.push(eq(files.fileType, filter.fileType))
  }
  if (filter.locale) {
    conditions.push(eq(files.locale, filter.locale))
  }
  if (filter.contentType) {
    conditions.push(eq(files.contentType, filter.contentType))
  }

  let query = db.select().from(files)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  // Order by relative path if filtering by session, otherwise by created_at
  if (filter.sessionId) {
    return query.orderBy(asc(files.relativePath)).limit(limit).offset(offset)
  }

  return query.orderBy(desc(files.createdAt)).limit(limit).offset(offset)
}

/**
 * Get files for a session organized by locale and content type
 */
export async function getFilesBySessionGrouped(
  sessionId: string,
  fileType: FileType
): Promise<Map<string, Map<ContentType, TranslationFile[]>>> {
  const fileList = await listFiles({ sessionId, fileType, limit: 10000 })

  const grouped = new Map<string, Map<ContentType, TranslationFile[]>>()

  for (const file of fileList) {
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
export async function getUploadFiles(
  sessionId: string,
  locale?: string
): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'upload', locale, limit: 10000 })
}

/**
 * Get translation files for a session
 */
export async function getTranslationFiles(
  sessionId: string,
  locale?: string
): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'translation', locale, limit: 10000 })
}

/**
 * Get delta files for a session
 */
export async function getDeltaFiles(
  sessionId: string,
  locale?: string
): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'delta', locale, limit: 10000 })
}

/**
 * Get original files for a session (used in changes workflow)
 */
export async function getOriginalFiles(
  sessionId: string,
  locale?: string
): Promise<TranslationFile[]> {
  return listFiles({ sessionId, fileType: 'original', locale, limit: 10000 })
}

/**
 * Count files with filtering
 */
export async function countFiles(filter: FileFilter = {}): Promise<number> {
  const db = getDatabase()

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(files.sessionId, filter.sessionId))
  }
  if (filter.fileType) {
    conditions.push(eq(files.fileType, filter.fileType))
  }

  let query = db.select({ count: sql<number>`count(*)` }).from(files)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  const [result] = await query

  return Number(result?.count || 0)
}

/**
 * Get file statistics for a session
 */
export async function getFileStats(sessionId: string): Promise<FileStats> {
  const db = getDatabase()

  const countByType = await db
    .select({
      fileType: files.fileType,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(eq(files.sessionId, sessionId))
    .groupBy(files.fileType)

  const countByContentType = await db
    .select({
      contentType: files.contentType,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(eq(files.sessionId, sessionId))
    .groupBy(files.contentType)

  const countByLocale = await db
    .select({
      locale: files.locale,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(eq(files.sessionId, sessionId))
    .groupBy(files.locale)

  const [totals] = await db
    .select({
      totalCount: sql<number>`count(*)`,
      totalSize: sql<number>`COALESCE(SUM(${files.fileSize}), 0)`,
    })
    .from(files)
    .where(eq(files.sessionId, sessionId))

  const byType: Record<FileType, number> = {
    upload: 0,
    translation: 0,
    delta: 0,
    original: 0,
  }
  for (const row of countByType) {
    byType[row.fileType] = Number(row.count)
  }

  const byContentType: Record<ContentType, number> = {
    content: 0,
    global: 0,
    page: 0,
  }
  for (const row of countByContentType) {
    byContentType[row.contentType] = Number(row.count)
  }

  const byLocale: Record<string, number> = {}
  for (const row of countByLocale) {
    byLocale[row.locale] = Number(row.count)
  }

  return {
    totalCount: Number(totals?.totalCount || 0),
    byType,
    byContentType,
    byLocale,
    totalSize: Number(totals?.totalSize || 0),
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
    const promises = batch.map((input) => upsertFile(input))
    const createdFiles = await Promise.all(promises)
    results.push(...createdFiles)
  }

  log.info('Bulk created files', { count: results.length })
  return results
}

/**
 * Get locales with files for a session
 */
export async function getLocalesForSession(
  sessionId: string,
  fileType?: FileType
): Promise<string[]> {
  const db = getDatabase()

  const conditions = [eq(files.sessionId, sessionId)]
  if (fileType) {
    conditions.push(eq(files.fileType, fileType))
  }

  const rows = await db
    .selectDistinct({ locale: files.locale })
    .from(files)
    .where(and(...conditions))
    .orderBy(files.locale)

  return rows.map((r) => r.locale)
}
