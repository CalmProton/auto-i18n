import { readFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join as pathJoin, posix as pathPosix } from 'node:path'
import type {
  TranslationFileDescriptor,
  TranslationJobMetadata,
  TranslationMetadataFile,
  TranslationMetadataUpdate,
  TranslationIssueMetadata,
  TranslationPullRequestMetadata,
  TranslationRepositoryMetadata,
  TranslationBranchMetadata
} from '../../types'
import { GitHubClient, type GitCommit } from './client'
import { createScopedLogger } from '../../utils/logger'
import { loadMetadata, updateMetadata } from '../../utils/jobMetadata'
import { tempRoot } from '../../utils/fileStorage'

const log = createScopedLogger('services:github:workflow')

export interface FinalizeTranslationJobOptions {
  senderId: string
  jobId?: string
  metadataUpdate?: TranslationMetadataUpdate
  dryRun?: boolean
}

export interface FinalizeTranslationJobResult {
  senderId: string
  branchName: string
  baseCommitSha: string
  seededLocales: string[]
  translatedLocales: string[]
  issueNumber: number
  pullRequestNumber: number
  pullRequestUrl: string
  commits: Array<{ sha: string; message: string }>
}

interface PreparedJob {
  metadata: TranslationMetadataFile
  job: TranslationJobMetadata
  repository: TranslationRepositoryMetadata
  sourceLocale: string
  targetLocales: string[]
  branchName: string
  issue?: TranslationIssueMetadata
  pullRequest?: TranslationPullRequestMetadata
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function resolveTempFilePath(senderId: string, segments: string[]): string {
  const sanitizedSender = sanitizeSegment(senderId)
  const flattened = segments.flatMap((segment) => splitPath(segment))
  return pathJoin(tempRoot, sanitizedSender, ...flattened)
}

function splitPath(value: string): string[] {
  return value.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

function collectLocalesFromTranslations(senderId: string): string[] {
  const basePath = resolveTempFilePath(senderId, ['translations'])
  if (!existsSync(basePath)) {
    return []
  }

  try {
    const entries = readdirSync(basePath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    log.warn('Unable to enumerate translation locales', {
      senderId,
      basePath,
      error
    })
    return []
  }
}

function applyLocalePattern(pattern: string, locale: string, sourceLocale: string): string {
  return pattern
    .replace(/:locale/g, locale)
    .replace(/:sourceLocale/g, sourceLocale)
}

function deriveTargetRepoPath(
  descriptor: TranslationFileDescriptor,
  targetLocale: string,
  sourceLocale: string
): string {
  if (descriptor.targetPathPattern) {
    return applyLocalePattern(descriptor.targetPathPattern, targetLocale, sourceLocale)
  }

  const directory = pathPosix.dirname(descriptor.repositorySourcePath)
  const fileName = pathPosix.basename(descriptor.repositorySourcePath)

  if (descriptor.type === 'global' || descriptor.type === 'page') {
    return pathPosix.join(directory, `${targetLocale}.json`)
  }

  if (descriptor.type === 'content') {
    const localeSegment = `/${sourceLocale}/`
    if (descriptor.repositorySourcePath.includes(localeSegment)) {
      return descriptor.repositorySourcePath.replace(localeSegment, `/${targetLocale}/`)
    }

    const dotPattern = `.${sourceLocale}.`
    if (descriptor.repositorySourcePath.includes(dotPattern)) {
      return descriptor.repositorySourcePath.replace(dotPattern, `.${targetLocale}.`)
    }

    return pathPosix.join(directory, targetLocale, fileName)
  }

  return pathPosix.join(directory, fileName)
}

function deriveTranslationTempRelativePath(
  descriptor: TranslationFileDescriptor,
  locale: string,
  sourceLocale: string
): string {
  if (descriptor.translationTempPathPattern) {
    return applyLocalePattern(descriptor.translationTempPathPattern, locale, sourceLocale)
  }

  if (descriptor.type === 'global') {
    return `${locale}.json`
  }

  const segments = splitPath(descriptor.sourceTempRelativePath)
  if (descriptor.type === 'page') {
    if (segments.length <= 1) {
      return `${locale}.json`
    }
    const folder = segments.slice(0, -1)
    return pathPosix.join(...folder, `${locale}.json`)
  }

  return descriptor.sourceTempRelativePath
}

async function readTempFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    log.warn('Unable to read temporary file', {
      path,
      error
    })
    return null
  }
}

async function prepareJob(options: FinalizeTranslationJobOptions): Promise<PreparedJob> {
  let metadata: TranslationMetadataFile | null = await loadMetadata(options.senderId)

  if (!metadata) {
    throw new Error('No metadata.json found for this sender. Upload files with metadata before finalizing.')
  }

  if (options.metadataUpdate) {
    metadata = await updateMetadata(options.senderId, options.metadataUpdate)
  }

  if (!metadata.jobs || metadata.jobs.length === 0) {
    throw new Error('No translation jobs recorded in metadata.json.')
  }

  let desiredJobId = options.jobId
  if (!desiredJobId && options.metadataUpdate?.jobs && options.metadataUpdate.jobs.length > 0) {
    desiredJobId = options.metadataUpdate.jobs[0].id
  }

  let job = desiredJobId
    ? metadata.jobs.find((entry) => entry.id === desiredJobId)
    : metadata.jobs[0]

  if (!job) {
    throw new Error(`Unable to find job metadata for id "${desiredJobId}"`)
  }

  if (!job.files || job.files.length === 0) {
    throw new Error(`Job "${job.id}" does not contain any file descriptors.`)
  }

  const repository: TranslationRepositoryMetadata | undefined = metadata.repository
  if (!repository || !repository.owner || !repository.name || !repository.baseBranch || !repository.baseCommitSha) {
    throw new Error('Repository information is missing from metadata.json.')
  }

  const sourceLocale = job.sourceLocale ?? metadata.sourceLocale
  if (!sourceLocale) {
    throw new Error('Source locale is missing from metadata.json.')
  }

  let targetLocales = job.targetLocales ?? metadata.targetLocales
  if (!targetLocales || targetLocales.length === 0) {
    targetLocales = collectLocalesFromTranslations(options.senderId)
  }

  if (!targetLocales || targetLocales.length === 0) {
    throw new Error('No target locales available for translation job.')
  }

  // ensure uniqueness and stable order
  const uniqueTargets = Array.from(new Set(targetLocales))

  const branchSource: TranslationBranchMetadata = {
    prefix: job.branch?.prefix ?? metadata.branch?.prefix,
    name: job.branch?.name ?? metadata.branch?.name
  }

  const branchName = branchSource.name
    ?? `${branchSource.prefix ?? 'auto-i18n'}/${sanitizeSegment(options.senderId)}/${Date.now().toString(36)}`

  const resolvedBranch: TranslationBranchMetadata = {
    prefix: branchSource.prefix,
    name: branchName
  }

  const issue: TranslationIssueMetadata | undefined = job.issue ?? metadata.issue
  const pullRequest: TranslationPullRequestMetadata | undefined = job.pullRequest ?? metadata.pullRequest

  metadata = await updateMetadata(options.senderId, {
    repository,
    sourceLocale,
    targetLocales: metadata.targetLocales ?? uniqueTargets,
    branch: resolvedBranch,
    jobs: [
      {
        id: job.id,
        branch: resolvedBranch,
        files: job.files,
        sourceLocale,
        targetLocales: job.targetLocales ?? uniqueTargets,
        issue: job.issue,
        pullRequest: job.pullRequest
      }
    ]
  })

  const refreshedJob = metadata.jobs.find((entry) => entry.id === job.id)
  if (!refreshedJob || !refreshedJob.files || refreshedJob.files.length === 0) {
    throw new Error('Failed to persist job metadata updates.')
  }

  return {
    metadata,
    job: refreshedJob,
    repository,
    sourceLocale,
    targetLocales: uniqueTargets,
    branchName,
    issue,
    pullRequest
  }
}

async function createCommitFromFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  baseTreeSha: string,
  parentSha: string,
  entries: Array<{ path: string; content: string }>,
  message: string
): Promise<GitCommit | null> {
  if (entries.length === 0) {
    log.info('Skipping commit because there are no file changes', { message })
    return null
  }

  const treeEntries = []
  for (const entry of entries) {
    const blob = await client.createBlob(owner, repo, entry.content)
    treeEntries.push({
      path: entry.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blob.sha
    })
  }

  const tree = await client.createTree(owner, repo, treeEntries, baseTreeSha)
  const commit = await client.createCommit(owner, repo, message, tree.sha, [parentSha])

  log.info('Created commit', {
    repo: `${owner}/${repo}`,
    message,
    sha: commit.sha,
    files: entries.map((entry) => entry.path)
  })

  return commit
}

export async function finalizeTranslationJob(
  options: FinalizeTranslationJobOptions
): Promise<FinalizeTranslationJobResult> {
  const prepared = await prepareJob(options)
  const {
    metadata,
    job,
    repository,
    sourceLocale,
    targetLocales,
    branchName,
    issue: issueMetadata,
    pullRequest: pullRequestMetadata
  } = prepared

  const client = new GitHubClient()
  const { owner, name: repo, baseBranch, baseCommitSha } = repository

  log.info('Starting translation job finalization', {
    senderId: options.senderId,
    owner,
    repo,
    baseBranch,
    baseCommitSha,
    branchName,
    targetLocales
  })

  if (!options.dryRun) {
    await client.createRef(owner, repo, `heads/${branchName}`, baseCommitSha)
  }

  const issueTitle = issueMetadata?.title
    ?? `Translate ${sourceLocale} resources to ${targetLocales.join(', ')}`
  const issueBody = issueMetadata?.body
    ?? `Automated translation request for locales: ${targetLocales.join(', ')}.`

  const issue = options.dryRun
    ? { number: 0, url: '', html_url: '', title: issueTitle }
    : await client.createIssue({ owner, repo, title: issueTitle, body: issueBody })

  const seededFiles: Array<{ path: string; content: string }> = []
  for (const descriptor of job.files) {
    const sourcePath = resolveTempFilePath(options.senderId, [
      'uploads',
      sourceLocale,
      descriptor.type,
      descriptor.sourceTempRelativePath
    ])

    const sourceContent = await readTempFile(sourcePath)
    if (!sourceContent) {
      continue
    }

    for (const locale of targetLocales) {
      if (locale === sourceLocale) {
        continue
      }
      const targetRepoPath = deriveTargetRepoPath(descriptor, locale, sourceLocale)
      seededFiles.push({ path: targetRepoPath, content: sourceContent })
    }
  }

  const baseCommit = await client.getCommit(owner, repo, baseCommitSha)
  const firstCommit = await createCommitFromFiles(
    client,
    owner,
    repo,
    baseCommit.tree.sha,
    baseCommit.sha,
    seededFiles,
    `chore(i18n): seed ${targetLocales.join(', ')} from ${sourceLocale}`
  )

  let currentCommitSha = firstCommit?.sha ?? baseCommit.sha
  let currentTreeSha = firstCommit?.tree.sha ?? baseCommit.tree.sha
  const commits: Array<{ sha: string; message: string }> = []
  if (firstCommit) {
    commits.push({ sha: firstCommit.sha, message: firstCommit.message })
  }

  const translatedFiles: Array<{ path: string; content: string }> = []
  for (const descriptor of job.files) {
    for (const locale of targetLocales) {
      if (locale === sourceLocale) {
        continue
      }
      const translationRelative = deriveTranslationTempRelativePath(descriptor, locale, sourceLocale)
      const translationPath = resolveTempFilePath(options.senderId, [
        'translations',
        locale,
        descriptor.type,
        translationRelative
      ])
      const translationContent = await readTempFile(translationPath)
      if (!translationContent) {
        continue
      }
      const targetRepoPath = deriveTargetRepoPath(descriptor, locale, sourceLocale)
      translatedFiles.push({ path: targetRepoPath, content: translationContent })
    }
  }

  if (translatedFiles.length > 0) {
    const secondCommit = await createCommitFromFiles(
      client,
      owner,
      repo,
      currentTreeSha,
      currentCommitSha,
      translatedFiles,
      `feat(i18n): apply translations for ${targetLocales.join(', ')}`
    )
    if (secondCommit) {
      commits.push({ sha: secondCommit.sha, message: secondCommit.message })
      currentCommitSha = secondCommit.sha
      currentTreeSha = secondCommit.tree.sha
    }
  }

  if (!options.dryRun) {
    await client.updateRef(owner, repo, `heads/${branchName}`, currentCommitSha)
  }

  if (commits.length === 0) {
    throw new Error('No file changes were produced for this translation job. Aborting pull request creation.')
  }

  const prTitle = pullRequestMetadata?.title
    ?? `Translate ${sourceLocale} ➜ ${targetLocales.join(', ')}`
  const prBody = pullRequestMetadata?.body
    ?? `## Summary\n\n- seed locale files for ${targetLocales.join(', ')}\n- apply automated translations${issue.number > 0 ? `\n\nCloses #${issue.number}` : ''}`

  const prBase = pullRequestMetadata?.baseBranch ?? baseBranch

  const pullRequest = options.dryRun
    ? { number: 0, url: '', html_url: '', head: { ref: branchName }, base: { ref: prBase } }
    : await client.createPullRequest({ owner, repo, title: prTitle, head: branchName, base: prBase, body: prBody })

  log.info('Translation finalization completed', {
    senderId: options.senderId,
    branchName,
    issueNumber: issue.number,
    pullRequestNumber: pullRequest.number,
    commits: commits.map((commit) => commit.sha)
  })

  return {
    senderId: options.senderId,
    branchName,
    baseCommitSha,
  seededLocales: targetLocales.filter((locale) => locale !== sourceLocale),
  translatedLocales: translatedFiles.length > 0 ? targetLocales.filter((locale) => locale !== sourceLocale) : [],
    issueNumber: issue.number,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url ?? '',
    commits
  }
}
