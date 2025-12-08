import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  TranslationJobMetadata,
  TranslationMetadataFile,
  TranslationMetadataUpdate
} from '../types'
import { getTempRoot } from './fileStorage'
import { createScopedLogger } from './logger'

const log = createScopedLogger('utils:jobMetadata')
const METADATA_FILE_NAME = 'metadata.json'

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function getMetadataPath(senderId: string): string {
  return join(getTempRoot(), sanitizeSegment(senderId), METADATA_FILE_NAME)
}

function createEmptyMetadata(senderId: string): TranslationMetadataFile {
  const timestamp = new Date().toISOString()
  return {
    senderId,
    jobs: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export async function loadMetadata(senderId: string): Promise<TranslationMetadataFile | null> {
  const path = getMetadataPath(senderId)
  if (!existsSync(path)) {
    return null
  }

  try {
    const content = await readFile(path, 'utf8')
    const metadata = JSON.parse(content) as TranslationMetadataFile
    if (!Array.isArray(metadata.jobs)) {
      metadata.jobs = []
    }
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

export async function saveMetadata(metadata: TranslationMetadataFile): Promise<void> {
  const path = getMetadataPath(metadata.senderId)
  const directory = dirname(path)

  await mkdir(directory, { recursive: true })

  const payload = JSON.stringify(metadata, null, 2)

  await writeFile(path, payload, 'utf8')

  log.info('Stored job metadata', {
    senderId: metadata.senderId,
    path
  })
}

function mergeJobs(existing: TranslationJobMetadata[], updates: TranslationJobMetadata[]): TranslationJobMetadata[] {
  const now = new Date().toISOString()
  const jobMap = new Map(existing.map((job) => [job.id, job]))

  for (const update of updates) {
    if (!update.id) {
      log.warn('Skipping job metadata without id', { update })
      continue
    }

    const current = jobMap.get(update.id)
    const merged: TranslationJobMetadata = {
      id: update.id,
      type: update.type ?? current?.type,
      files: update.files ?? current?.files ?? [],
      sourceLocale: update.sourceLocale ?? current?.sourceLocale,
      targetLocales: update.targetLocales ?? current?.targetLocales,
      issue: update.issue ?? current?.issue,
      pullRequest: update.pullRequest ?? current?.pullRequest,
      branch: update.branch ?? current?.branch,
      createdAt: current?.createdAt ?? update.createdAt ?? now,
      updatedAt: now
    }

    if (merged.files.length === 0) {
      log.warn('Job metadata missing files; skipping entry', {
        jobId: merged.id
      })
      continue
    }

    jobMap.set(merged.id, merged)
  }

  return Array.from(jobMap.values())
}

function mergeTopLevel(
  existing: TranslationMetadataFile,
  update: TranslationMetadataUpdate
): TranslationMetadataFile {
  const now = new Date().toISOString()

  const merged: TranslationMetadataFile = {
    ...existing,
    repository: update.repository ?? existing.repository,
    sourceLocale: update.sourceLocale ?? existing.sourceLocale,
    targetLocales: update.targetLocales ?? existing.targetLocales,
    issue: update.issue ?? existing.issue,
    pullRequest: update.pullRequest ?? existing.pullRequest,
    branch: update.branch ?? existing.branch,
    jobs: update.jobs ? mergeJobs(existing.jobs, update.jobs) : existing.jobs,
    updatedAt: now
  }

  if (!merged.jobs) {
    merged.jobs = []
  }

  return merged
}

export async function updateMetadata(
  senderId: string,
  update: TranslationMetadataUpdate
): Promise<TranslationMetadataFile> {
  const existing = (await loadMetadata(senderId)) ?? createEmptyMetadata(senderId)
  const merged = mergeTopLevel(existing, update)
  await saveMetadata(merged)
  return merged
}
