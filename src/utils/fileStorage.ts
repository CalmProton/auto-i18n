import { mkdirSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type { FileType, SavedFileInfo } from '../types'

type SaveFileOptions = {
  senderId: string
  locale: string
  type: FileType
  file: File
  folderName?: string
}

const DEFAULT_TEMP_ROOT = join(process.cwd(), 'tmp', 'uploads')

export const tempRoot = process.env.AUTO_I18N_TEMP_DIR ?? DEFAULT_TEMP_ROOT

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureDirectory(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function buildDirectory({ senderId, locale, type, folderName }: SaveFileOptions): string {
  const baseDir = join(tempRoot, sanitizeSegment(senderId), sanitizeSegment(locale), type)
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

function ensureUniqueFilePath(directory: string, originalName: string): string {
  const ext = extname(originalName)
  const baseName = basename(originalName, ext)
  let sanitizedBase = sanitizeSegment(baseName)
  const sanitizedExt = sanitizeSegment(ext)

  if (!sanitizedBase) {
    sanitizedBase = 'file'
  }

  let candidate = join(directory, `${sanitizedBase}${sanitizedExt}`)
  let counter = 1

  while (existsSync(candidate)) {
    candidate = join(directory, `${sanitizedBase}-${counter}${sanitizedExt}`)
    counter += 1
  }

  return candidate
}

export async function saveFileToTemp(options: SaveFileOptions): Promise<SavedFileInfo> {
  const { file, folderName, type } = options
  const directory = buildDirectory(options)
  const originalName = file.name || `${type}-upload`
  const filePath = ensureUniqueFilePath(directory, originalName)

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
