import { readFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join as pathJoin, posix as pathPosix } from 'node:path'
import type { TranslationFileDescriptor, TranslationJobMetadata } from '../../types'
import { GitHubClient, type GitCommit } from './client'
import { createScopedLogger } from '../../utils/logger'
import { loadJobMetadata, saveJobMetadata } from '../../utils/jobMetadata'
import { tempRoot } from '../../utils/fileStorage'

const log = createScopedLogger('services:github:workflow')

export interface FinalizeTranslationJobOptions {
  senderId: string
  metadata?: Partial<TranslationJobMetadata>
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
  metadata: TranslationJobMetadata
  targetLocales: string[]
  branchName: string
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
  const existingMetadata = await loadJobMetadata(options.senderId)
  const merged: TranslationJobMetadata | null = existingMetadata
    ? { ...existingMetadata, ...options.metadata, updatedAt: existingMetadata.updatedAt }
    : null

  const metadata = merged ?? (() => {
    if (!options.metadata) {
      throw new Error('Job metadata not found. Provide metadata payload to finalize translation job.')
    }

    const now = new Date().toISOString()
    return {
      senderId: options.senderId,
      createdAt: now,
      updatedAt: now,
      files: options.metadata.files ?? [],
      repository: options.metadata.repository ?? (() => { throw new Error('Missing repository information in metadata.') })(),
      sourceLocale: options.metadata.sourceLocale ?? (() => { throw new Error('Missing source locale in metadata.') })(),
      targetLocales: options.metadata.targetLocales,
      issue: options.metadata.issue,
      pullRequest: options.metadata.pullRequest,
      branch: options.metadata.branch
    }
  })()

  if (!metadata.files || metadata.files.length === 0) {
    throw new Error('Translation job metadata has no file descriptors.')
  }

  if (!metadata.repository?.owner || !metadata.repository?.name) {
    throw new Error('Translation job metadata is missing repository owner/name.')
  }

  if (!metadata.repository.baseBranch) {
    throw new Error('Translation job metadata is missing base branch.')
  }

  if (!metadata.repository.baseCommitSha) {
    throw new Error('Translation job metadata is missing base commit SHA.')
  }

  if (!metadata.sourceLocale) {
    throw new Error('Translation job metadata is missing source locale.')
  }

  const detectedLocales = collectLocalesFromTranslations(options.senderId)
  const targetLocales = (metadata.targetLocales && metadata.targetLocales.length > 0)
    ? metadata.targetLocales
    : detectedLocales

  if (targetLocales.length === 0) {
    throw new Error('No target locales found for translation job.')
  }

  const branchName = metadata.branch?.name
    || `${metadata.branch?.prefix ?? 'auto-i18n'}/${sanitizeSegment(options.senderId)}/${Date.now().toString(36)}`

  await saveJobMetadata({
    ...metadata,
    branch: { ...metadata.branch, name: branchName },
    targetLocales,
    updatedAt: metadata.updatedAt ?? new Date().toISOString()
  })

  return { metadata: { ...metadata, branch: { ...metadata.branch, name: branchName }, targetLocales }, targetLocales, branchName }
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
  const { metadata, targetLocales, branchName } = await prepareJob(options)

  const client = new GitHubClient()
  const { owner, name: repo, baseBranch, baseCommitSha } = metadata.repository
  const sourceLocale = metadata.sourceLocale

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

  const issueTitle = metadata.issue?.title
    ?? `Translate ${sourceLocale} resources to ${targetLocales.join(', ')}`
  const issueBody = metadata.issue?.body
    ?? `Automated translation request for locales: ${targetLocales.join(', ')}.`

  const issue = options.dryRun
    ? { number: 0 }
    : await client.createIssue({ owner, repo, title: issueTitle, body: issueBody })

  const seededFiles: Array<{ path: string; content: string }> = []
  for (const descriptor of metadata.files) {
    const sourcePath = resolveTempFilePath(options.senderId, [
      'uploads',
      metadata.sourceLocale,
      descriptor.type,
      descriptor.sourceTempRelativePath
    ])

    const sourceContent = await readTempFile(sourcePath)
    if (!sourceContent) {
      continue
    }

    for (const locale of targetLocales) {
      if (locale === metadata.sourceLocale) {
        continue
      }
      const targetRepoPath = deriveTargetRepoPath(descriptor, locale, metadata.sourceLocale)
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
    `chore(i18n): seed ${targetLocales.join(', ')} from ${metadata.sourceLocale}`
  )

  let currentCommitSha = firstCommit?.sha ?? baseCommit.sha
  let currentTreeSha = firstCommit?.tree.sha ?? baseCommit.tree.sha
  const commits: Array<{ sha: string; message: string }> = []
  if (firstCommit) {
    commits.push({ sha: firstCommit.sha, message: firstCommit.message })
  }

  const translatedFiles: Array<{ path: string; content: string }> = []
  for (const descriptor of metadata.files) {
    for (const locale of targetLocales) {
      if (locale === metadata.sourceLocale) {
        continue
      }
      const translationRelative = deriveTranslationTempRelativePath(descriptor, locale, metadata.sourceLocale)
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
      const targetRepoPath = deriveTargetRepoPath(descriptor, locale, metadata.sourceLocale)
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

  const prTitle = metadata.pullRequest?.title
    ?? `Translate ${sourceLocale} ➜ ${targetLocales.join(', ')}`
  const prBody = metadata.pullRequest?.body
    ?? `## Summary\n\n- seed locale files for ${targetLocales.join(', ')}\n- apply automated translations\n\nCloses #${issue.number}`

  const prBase = metadata.pullRequest?.baseBranch ?? baseBranch

  const pullRequest = options.dryRun
    ? { number: 0, html_url: '', head: { ref: branchName }, base: { ref: prBase } }
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
    seededLocales: targetLocales.filter((locale) => locale !== metadata.sourceLocale),
    translatedLocales: translatedFiles.length > 0 ? targetLocales.filter((locale) => locale !== metadata.sourceLocale) : [],
    issueNumber: issue.number,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url ?? '',
    commits
  }
}
