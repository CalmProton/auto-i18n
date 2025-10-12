import type {
  TranslationMetadataUpdate,
  TranslationJobMetadata,
  TranslationFileDescriptor,
  TranslationFileType
} from '../types'
import { createScopedLogger } from './logger'

const log = createScopedLogger('utils:metadataInput')

function parseJson<T = unknown>(raw: unknown): T | null {
  if (raw === null || raw === undefined) {
    return null
  }

  if (typeof raw === 'object') {
    return raw as T
  }

  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as T
  } catch (error) {
    log.warn('Failed to parse metadata JSON payload', { error })
    return null
  }
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean)
    return items.length > 0 ? items : undefined
  }

  if (typeof value === 'string') {
    const parts = value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return parts.length > 0 ? parts : undefined
  }

  return undefined
}

function normalizeFileDescriptor(input: unknown): Partial<TranslationFileDescriptor> | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const { repositorySourcePath, sourceTempRelativePath, targetPathPattern, translationTempPathPattern, label } = input as Record<string, unknown>

  const repoPath = typeof repositorySourcePath === 'string' ? repositorySourcePath.trim() : undefined
  const sourcePath = typeof sourceTempRelativePath === 'string' ? sourceTempRelativePath.trim() : undefined
  const targetPattern = typeof targetPathPattern === 'string' ? targetPathPattern.trim() : undefined
  const translationPattern = typeof translationTempPathPattern === 'string' ? translationTempPathPattern.trim() : undefined
  const labelValue = typeof label === 'string' ? label.trim() : undefined

  const descriptor: Partial<TranslationFileDescriptor> = {}
  if (repoPath) {
    descriptor.repositorySourcePath = repoPath
  }
  if (sourcePath) {
    descriptor.sourceTempRelativePath = sourcePath
  }
  if (targetPattern) {
    descriptor.targetPathPattern = targetPattern
  }
  if (translationPattern) {
    descriptor.translationTempPathPattern = translationPattern
  }
  if (labelValue) {
    descriptor.label = labelValue
  }

  return descriptor
}

function extractJobs(value: unknown): Array<Partial<TranslationJobMetadata>> {
  if (!value) {
    return []
  }

  let payload: unknown[]
  
  if (Array.isArray(value)) {
    payload = value
  } else if (typeof value === 'object' && value !== null) {
    // Handle object with job IDs as keys: { "job-id": { type: "...", files: [...] } }
    const jobsObj = value as Record<string, unknown>
    payload = Object.entries(jobsObj).map(([jobId, jobData]) => {
      if (typeof jobData === 'object' && jobData !== null) {
        return { id: jobId, ...jobData }
      }
      return jobData
    })
  } else {
    payload = [value]
  }
  
  const normalized: Array<Partial<TranslationJobMetadata>> = []

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const record = entry as Record<string, unknown>
    const idRaw = record.id ?? record.jobId ?? record.key ?? record.type
    const id = typeof idRaw === 'string' ? idRaw.trim() : undefined
    const type = typeof record.type === 'string' ? record.type.trim() : undefined
    const filesRaw = record.files

    const files: Array<Partial<TranslationFileDescriptor>> = []
    if (Array.isArray(filesRaw)) {
      for (const item of filesRaw) {
        const descriptor = normalizeFileDescriptor(item)
        if (descriptor) {
          files.push(descriptor)
        }
      }
    } else if (filesRaw) {
      const descriptor = normalizeFileDescriptor(filesRaw)
      if (descriptor) {
        files.push(descriptor)
      }
    }

    const sourceLocale = typeof record.sourceLocale === 'string' ? record.sourceLocale.trim() : undefined
    const targetLocales = toStringArray(record.targetLocales)

    const issue = record.issue && typeof record.issue === 'object' ? record.issue as TranslationJobMetadata['issue'] : undefined
    const pullRequest = record.pullRequest && typeof record.pullRequest === 'object' ? record.pullRequest as TranslationJobMetadata['pullRequest'] : undefined
    const branch = record.branch && typeof record.branch === 'object' ? record.branch as TranslationJobMetadata['branch'] : undefined

    const createdAt = typeof record.createdAt === 'string' ? record.createdAt : undefined
    const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : undefined

    const jobEntry: Partial<TranslationJobMetadata> = {
      id,
      type,
      sourceLocale,
      targetLocales,
      issue,
      pullRequest,
      branch,
      createdAt,
      updatedAt
    }

    if (files.length > 0) {
      jobEntry.files = files as unknown as TranslationFileDescriptor[]
    }

    normalized.push(jobEntry)
  }

  return normalized
}

export interface MetadataExtractionOptions {
  rawMetadata: unknown
  fallbackRepositorySourcePath?: string
  defaultJobId: string
  jobType: TranslationFileType
  sourceLocale: string
  actualFiles: Array<{
    sourceTempRelativePath: string
    repositorySourcePath?: string
    targetPathPattern?: string
    translationTempPathPattern?: string
    label?: string
  }>
}

export type MetadataExtractionResult =
  | { update: TranslationMetadataUpdate }
  | { error: string }

export function extractMetadataUpdate(options: MetadataExtractionOptions): MetadataExtractionResult {
  const metadataObj = parseJson<Record<string, unknown>>(options.rawMetadata)

  if (!metadataObj) {
    return { error: 'Metadata payload is required and must be valid JSON.' }
  }

  const repository = metadataObj.repository && typeof metadataObj.repository === 'object'
    ? metadataObj.repository as TranslationMetadataUpdate['repository']
    : undefined

  const sourceLocale = typeof metadataObj.sourceLocale === 'string'
    ? metadataObj.sourceLocale.trim()
    : undefined

  const targetLocales = toStringArray(metadataObj.targetLocales)
  const issue = metadataObj.issue && typeof metadataObj.issue === 'object'
    ? metadataObj.issue as TranslationMetadataUpdate['issue']
    : undefined
  const pullRequest = metadataObj.pullRequest && typeof metadataObj.pullRequest === 'object'
    ? metadataObj.pullRequest as TranslationMetadataUpdate['pullRequest']
    : undefined
  const branch = metadataObj.branch && typeof metadataObj.branch === 'object'
    ? metadataObj.branch as TranslationMetadataUpdate['branch']
    : undefined

  const jobs: Array<Partial<TranslationJobMetadata>> = []
  jobs.push(...extractJobs(metadataObj.jobs))

  if (metadataObj.job && typeof metadataObj.job === 'object') {
    jobs.push(...extractJobs(metadataObj.job))
  }

  const fallbackRepo = typeof metadataObj.repositorySourcePath === 'string'
    ? metadataObj.repositorySourcePath.trim()
    : options.fallbackRepositorySourcePath

  let jobId = typeof metadataObj.jobId === 'string' ? metadataObj.jobId.trim() : undefined
  if (!jobId) {
    const primaryJob = jobs.find((job) => job.id)
    jobId = primaryJob?.id
  }
  if (!jobId) {
    jobId = options.defaultJobId
  }

  const normalizedJobs: TranslationJobMetadata[] = []
  const now = new Date().toISOString()

  let targetJobFound = false

  for (const jobEntry of jobs) {
    const currentId = jobEntry.id ?? options.defaultJobId
    const isTargetJob = currentId === jobId || (!targetJobFound && !jobEntry.id)

    const type = jobEntry.type ?? options.jobType
    const files = jobEntry.files ?? []

    let descriptors: TranslationFileDescriptor[] | null = null

    if (isTargetJob) {
      targetJobFound = true
      if (files.length === 0 && fallbackRepo) {
        descriptors = options.actualFiles.map((file) => ({
          type: options.jobType,
          sourceTempRelativePath: file.sourceTempRelativePath,
          repositorySourcePath: file.repositorySourcePath ?? fallbackRepo,
          targetPathPattern: file.targetPathPattern,
          translationTempPathPattern: file.translationTempPathPattern,
          label: file.label
        }))
      } else if (files.length === options.actualFiles.length) {
        descriptors = files.map((descriptor, index) => {
          const file = options.actualFiles[index]
          const repoPath = descriptor.repositorySourcePath ?? file.repositorySourcePath ?? fallbackRepo
          if (!repoPath) {
            throw new Error(`Job ${currentId} is missing repositorySourcePath for file #${index + 1}`)
          }
          return {
            type: descriptor.type ?? options.jobType,
            repositorySourcePath: repoPath,
            sourceTempRelativePath: file.sourceTempRelativePath,
            targetPathPattern: descriptor.targetPathPattern ?? file.targetPathPattern,
            translationTempPathPattern: descriptor.translationTempPathPattern ?? file.translationTempPathPattern,
            label: descriptor.label ?? file.label
          }
        })
      } else if (files.length === 1 && options.actualFiles.length > 1) {
        // replicate single descriptor across all files
        const baseDescriptor = files[0]
        const repoPath = baseDescriptor.repositorySourcePath ?? fallbackRepo
        if (!repoPath) {
          throw new Error(`Job ${currentId} is missing repositorySourcePath for its files`)
        }
        descriptors = options.actualFiles.map((file) => ({
          type: baseDescriptor.type ?? options.jobType,
          repositorySourcePath: repoPath,
          sourceTempRelativePath: file.sourceTempRelativePath,
          targetPathPattern: baseDescriptor.targetPathPattern ?? file.targetPathPattern,
          translationTempPathPattern: baseDescriptor.translationTempPathPattern ?? file.translationTempPathPattern,
          label: baseDescriptor.label ?? file.label
        }))
      } else if (files.length === 0) {
        throw new Error(`Job ${currentId} must include at least one file descriptor with repositorySourcePath.`)
      } else {
        throw new Error(`Job ${currentId} file descriptor count (${files.length}) does not match uploaded file count (${options.actualFiles.length}).`)
      }
    } else {
      if (files.length === 0) {
        log.warn('Ignoring job entry without files', { jobId: currentId })
        continue
      }
      descriptors = files.map((descriptor) => {
        const repoPath = descriptor.repositorySourcePath ?? fallbackRepo
        if (!repoPath || !descriptor.sourceTempRelativePath) {
          throw new Error(`Job ${currentId} requires repositorySourcePath and sourceTempRelativePath`)
        }
        return {
          type: descriptor.type ?? type ?? options.jobType,
          repositorySourcePath: repoPath,
          sourceTempRelativePath: descriptor.sourceTempRelativePath,
          targetPathPattern: descriptor.targetPathPattern,
          translationTempPathPattern: descriptor.translationTempPathPattern,
          label: descriptor.label
        }
      })
    }

    const source = jobEntry.sourceLocale ?? sourceLocale ?? options.sourceLocale
    const targets = jobEntry.targetLocales ?? targetLocales

    normalizedJobs.push({
      id: currentId,
      type: type ?? options.jobType,
      files: descriptors ?? [],
      sourceLocale: source,
      targetLocales: targets,
      issue: jobEntry.issue,
      pullRequest: jobEntry.pullRequest,
      branch: jobEntry.branch,
      createdAt: jobEntry.createdAt ?? now,
      updatedAt: now
    })
  }

  if (!targetJobFound) {
    if (!fallbackRepo) {
      return { error: 'repositorySourcePath must be provided in metadata for the uploaded files.' }
    }

    const descriptors: TranslationFileDescriptor[] = options.actualFiles.map((file) => ({
      type: options.jobType,
      sourceTempRelativePath: file.sourceTempRelativePath,
      repositorySourcePath: file.repositorySourcePath ?? fallbackRepo,
      targetPathPattern: file.targetPathPattern,
      translationTempPathPattern: file.translationTempPathPattern,
      label: file.label
    }))

    normalizedJobs.push({
      id: jobId ?? options.defaultJobId,
      type: options.jobType,
      files: descriptors,
      sourceLocale: sourceLocale ?? options.sourceLocale,
      targetLocales: targetLocales,
      createdAt: now,
      updatedAt: now
    })
  }

  const update: TranslationMetadataUpdate = {
    repository,
    sourceLocale: sourceLocale ?? options.sourceLocale,
    targetLocales,
    issue,
    pullRequest,
    branch,
    jobs: normalizedJobs
  }

  return { update }
}
