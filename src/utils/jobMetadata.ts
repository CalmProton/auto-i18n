import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TranslationJobMetadata } from '../types'
import { tempRoot } from './fileStorage'
import { createScopedLogger } from './logger'

const log = createScopedLogger('utils:jobMetadata')
const METADATA_FILE_NAME = 'job.metadata.json'

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function getJobMetadataPath(senderId: string): string {
  return join(tempRoot, sanitizeSegment(senderId), METADATA_FILE_NAME)
}

export async function loadJobMetadata(senderId: string): Promise<TranslationJobMetadata | null> {
  const path = getJobMetadataPath(senderId)
  if (!existsSync(path)) {
    return null
  }

  try {
    const content = await readFile(path, 'utf8')
    const metadata = JSON.parse(content) as TranslationJobMetadata
    return metadata
  } catch (error) {
    log.error('Failed to read job metadata', {
      senderId,
      path,
      error
    })
    return null
  }
}

export async function saveJobMetadata(metadata: TranslationJobMetadata): Promise<void> {
  const path = getJobMetadataPath(metadata.senderId)
  const directory = dirname(path)

  await mkdir(directory, { recursive: true })

  const payload = JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2)

  await writeFile(path, payload, 'utf8')

  log.info('Stored job metadata', {
    senderId: metadata.senderId,
    path
  })
}
