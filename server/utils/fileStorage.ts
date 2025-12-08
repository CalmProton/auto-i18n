import { mkdirSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type { FileType, SavedFileInfo } from '../types'

export type StorageCategory = 'uploads' | 'translations'

export type SavePathOptions = {
  senderId: string
  locale: string
  type: FileType
  folderName?: string
  category?: StorageCategory
}

type SaveFileOptions = SavePathOptions & {
  file: File
}

const DEFAULT_TEMP_ROOT = join(process.cwd(), 'tmp')

/**
 * Get the temporary root directory.
 * This is a function (not a constant) to allow tests to override via environment variables.
 */
export function getTempRoot(): string {
  return process.env.AUTO_I18N_TEMP_DIR ?? DEFAULT_TEMP_ROOT
}

// Deprecated: Use getTempRoot() instead. Kept for backwards compatibility.
export const tempRoot = process.env.AUTO_I18N_TEMP_DIR ?? DEFAULT_TEMP_ROOT

const DEFAULT_CATEGORY: StorageCategory = 'uploads'

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureDirectory(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function resolveBaseDirectory({ senderId, locale, type, category }: SavePathOptions): string {
  const sanitizedCategory = sanitizeSegment((category ?? DEFAULT_CATEGORY) as string)
  return join(
    getTempRoot(),
    sanitizeSegment(senderId),
    sanitizedCategory,
    sanitizeSegment(locale),
    sanitizeSegment(type)
  )
}

function buildDirectory(options: SavePathOptions): string {
  const { folderName } = options
  const baseDir = resolveBaseDirectory(options)
  ensureDirectory(baseDir)

  if (!folderName) {
    return baseDir
  }

  const folderSegments = folderName
    .split(/[\\/]/)
    .map((segment) => sanitizeSegment(segment))
    .filter((segment) => segment.length > 0)

  let targetDir = baseDir
  for (const segment of folderSegments) {
    targetDir = join(targetDir, segment)
    ensureDirectory(targetDir)
  }

  return targetDir
}

export function resolveUploadPath(options: SavePathOptions): string {
  const { folderName } = options
  const baseDir = resolveBaseDirectory(options)

  if (!folderName) {
    return baseDir
  }

  const folderSegments = (folderName ?? '')
    .split(/[\\/]/)
    .map((segment) => sanitizeSegment(segment))
    .filter((segment) => segment.length > 0)

  return folderSegments.reduce((dir, segment) => join(dir, segment), baseDir)
}

export function resolveTranslationPath(options: Omit<SavePathOptions, 'category'>): string {
  return resolveUploadPath({ ...options, category: 'translations' })
}



function buildFilePath(directory: string, originalName: string): string {
  const ext = extname(originalName)
  const baseName = basename(originalName, ext)
  let sanitizedBase = sanitizeSegment(baseName)
  const sanitizedExt = sanitizeSegment(ext)

  if (!sanitizedBase) {
    sanitizedBase = 'file'
  }

  return join(directory, `${sanitizedBase}${sanitizedExt}`)
}

export async function saveFileToTemp(options: SaveFileOptions): Promise<SavedFileInfo> {
  const { file, folderName, type } = options
  const directory = buildDirectory(options)
  const originalName = file.name || `${type}-upload`
  const filePath = buildFilePath(directory, originalName)

  await Bun.write(filePath, file)

  return {
    name: originalName,
    size: file.size,
    path: filePath,
    folder: folderName,
    type
  }
}

export async function saveFilesToTemp(
  options: Omit<SaveFileOptions, 'file'>,
  files: Array<{ file: File; folderName?: string }>
): Promise<SavedFileInfo[]> {
  return Promise.all(
    files.map(({ file, folderName }) =>
      saveFileToTemp({ ...options, file, folderName })
    )
  )
}

export async function saveTextToTemp(
  options: SavePathOptions & { filename: string; content: string }
): Promise<SavedFileInfo> {
  const { filename, content, folderName, type } = options
  const directory = buildDirectory(options)
  const filePath = buildFilePath(directory, filename)

  await Bun.write(filePath, content)

  const size = new TextEncoder().encode(content).length

  return {
    name: filename,
    size,
    path: filePath,
    folder: folderName,
    type
  }
}
