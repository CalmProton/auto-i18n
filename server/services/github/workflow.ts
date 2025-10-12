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
    log.warn('Translations directory does not exist', { senderId, basePath })
    return []
  }

  try {
    const entries = readdirSync(basePath, { withFileTypes: true })
    const locales = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    
    log.info('Collected locales from translations', {
      senderId,
      basePath,
      locales,
      totalEntries: entries.length
    })
    
    return locales
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
  log.info('Initial target locales', {
    senderId: options.senderId,
    jobTargetLocales: job.targetLocales,
    metadataTargetLocales: metadata.targetLocales,
    targetLocales
  })
  
  // Check if we need to collect locales from translations directory
  // This happens when: no target locales, empty array, or only contains source locale
  const needsCollection = !targetLocales || 
    targetLocales.length === 0 || 
    (targetLocales.length === 1 && targetLocales[0] === sourceLocale)
  
  if (needsCollection) {
    targetLocales = collectLocalesFromTranslations(options.senderId)
    log.info('Collected target locales from translations', {
      senderId: options.senderId,
      collectedLocales: targetLocales,
      reason: needsCollection
    })
  }

  if (!targetLocales || targetLocales.length === 0) {
    throw new Error('No target locales available for translation job.')
  }

  // ensure uniqueness and stable order, exclude source locale from targets
  const uniqueTargets = Array.from(new Set(targetLocales)).filter(locale => locale !== sourceLocale)
  
  log.info('Processed target locales', {
    senderId: options.senderId,
    sourceLocale,
    originalTargets: targetLocales,
    uniqueTargets
  })

  if (uniqueTargets.length === 0) {
    throw new Error('No valid target locales available after excluding source locale.')
  }

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

  // Ensure required labels exist in the repository
  if (!options.dryRun) {
    const requiredLabels = [
      { name: 'i18n', color: '0052cc', description: 'Internationalization and localization' },
      { name: 'translation', color: '1d76db', description: 'Translation work' },
      { name: 'automated', color: '7057ff', description: 'Automated process' },
      { name: 'multi-locale', color: 'fbca04', description: 'Multiple locales involved' },
      { name: 'ready-for-review', color: '0e8a16', description: 'Ready for review' }
    ]
    await client.ensureLabelsExist(owner, repo, requiredLabels)

    // Check if branch exists, create if it doesn't
    const branchExists = await client.refExists(owner, repo, `heads/${branchName}`)
    if (!branchExists) {
      await client.createRef(owner, repo, `heads/${branchName}`, baseCommitSha)
      log.info('Created new branch', { branchName, baseCommitSha })
    } else {
      log.info('Branch already exists, using existing branch', { branchName })
    }
  }

  // Prepare issue content with better formatting and metadata
  // Aggregate files from all jobs to show complete file breakdown
  const allFiles = metadata.jobs.flatMap(job => job.files || [])
  const filesByType = allFiles.reduce((acc, file) => {
    if (!acc[file.type]) acc[file.type] = []
    acc[file.type].push(file)
    return acc
  }, {} as Record<string, typeof allFiles>)

  const issueTitle = issueMetadata?.title
    ?? `🌐 Translation: ${sourceLocale} → ${targetLocales.join(', ')}`

  const issueBody = issueMetadata?.body ?? (() => {
    const totalFileCount = allFiles.length
    const jobCount = metadata.jobs.length
    const typesList = Object.keys(filesByType).map(type => {
      const count = filesByType[type].length
      return `- **${type}**: ${count} file${count !== 1 ? 's' : ''}`
    }).join('\n')

    const jobsList = metadata.jobs.map(jobItem => {
      const jobFileCount = jobItem.files?.length || 0
      return `- **${jobItem.id}** (${jobItem.type}): ${jobFileCount} file${jobFileCount !== 1 ? 's' : ''}`
    }).join('\n')

    return `## 🎯 Translation Request

### Source & Targets
- **Source Locale**: \`${sourceLocale}\`
- **Target Locales**: ${targetLocales.map(locale => `\`${locale}\``).join(', ')}

### Translation Jobs
**Total Jobs**: ${jobCount}
**Total Files**: ${totalFileCount}

${jobsList}

### File Breakdown by Type
${typesList}

### Repository Details
- **Repository**: ${owner}/${repo}
- **Base Branch**: \`${baseBranch}\`
- **Work Branch**: \`${branchName}\`

---
*This is an automated translation request created by auto-i18n*`
  })()

  const issueLabels = ['i18n', 'translation', 'automated']
  if (targetLocales.length > 1) {
    issueLabels.push('multi-locale')
  }

  const issue = options.dryRun
    ? { number: 0, url: '', html_url: '', title: issueTitle }
    : await client.createIssue({ 
        owner, 
        repo, 
        title: issueTitle, 
        body: issueBody,
        labels: issueLabels
      })

  // Collect all files to be processed by locale
  const filesByLocale = new Map<string, { seeded: Array<{ path: string; content: string }>, translated: Array<{ path: string; content: string }> }>()
  
  // Initialize maps for each target locale
  for (const locale of targetLocales) {
    if (locale !== sourceLocale) {
      filesByLocale.set(locale, { seeded: [], translated: [] })
    }
  }

  // Process all jobs to collect seeded files by locale
  for (const currentJob of metadata.jobs) {
    if (!currentJob.files) continue
    
    for (const descriptor of currentJob.files) {
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
        const localeFiles = filesByLocale.get(locale)
        if (localeFiles) {
          localeFiles.seeded.push({ path: targetRepoPath, content: sourceContent })
        }
      }
    }
  }

  // Process all jobs to collect translated files by locale
  for (const currentJob of metadata.jobs) {
    if (!currentJob.files) continue
    
    for (const descriptor of currentJob.files) {
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
        const localeFiles = filesByLocale.get(locale)
        if (localeFiles) {
          localeFiles.translated.push({ path: targetRepoPath, content: translationContent })
        }
      }
    }
  }

  const baseCommit = await client.getCommit(owner, repo, baseCommitSha)
  let currentCommitSha = baseCommit.sha
  let currentTreeSha = baseCommit.tree.sha
  const commits: Array<{ sha: string; message: string }> = []

  // Create per-locale commits for seeding
  for (const locale of targetLocales) {
    if (locale === sourceLocale) continue
    
    const localeFiles = filesByLocale.get(locale)
    if (!localeFiles || localeFiles.seeded.length === 0) continue

    const seededCommit = await createCommitFromFiles(
      client,
      owner,
      repo,
      currentTreeSha,
      currentCommitSha,
      localeFiles.seeded,
      `chore(i18n): seed ${locale} from ${sourceLocale}

🌱 Created ${localeFiles.seeded.length} locale files for ${locale}
📁 Source files: ${allFiles.length} (${Object.keys(filesByType).join(', ')})
🎯 Target locale: \`${locale}\``
    )
    
    if (seededCommit) {
      commits.push({ sha: seededCommit.sha, message: seededCommit.message })
      currentCommitSha = seededCommit.sha
      currentTreeSha = seededCommit.tree.sha
      
      log.info('Created seeding commit for locale', {
        locale,
        commitSha: seededCommit.sha,
        filesCount: localeFiles.seeded.length
      })
    }
  }

  // Create per-locale commits for translations
  for (const locale of targetLocales) {
    if (locale === sourceLocale) continue
    
    const localeFiles = filesByLocale.get(locale)
    if (!localeFiles || localeFiles.translated.length === 0) continue

    const translatedCommit = await createCommitFromFiles(
      client,
      owner,
      repo,
      currentTreeSha,
      currentCommitSha,
      localeFiles.translated,
      `feat(i18n): apply translations for ${locale}

🔄 Applied automated translations to ${localeFiles.translated.length} files
✨ Translation complete for \`${locale}\`
🤖 Generated by auto-i18n`
    )
    
    if (translatedCommit) {
      commits.push({ sha: translatedCommit.sha, message: translatedCommit.message })
      currentCommitSha = translatedCommit.sha
      currentTreeSha = translatedCommit.tree.sha
      
      log.info('Created translation commit for locale', {
        locale,
        commitSha: translatedCommit.sha,
        filesCount: localeFiles.translated.length
      })
    }
  }

  if (!options.dryRun) {
    // Use force update to handle existing branches
    await client.updateRef(owner, repo, `heads/${branchName}`, currentCommitSha, true)
  }

  // Calculate total files processed across all locales
  const totalSeededFiles = Array.from(filesByLocale.values()).reduce((sum, locale) => sum + locale.seeded.length, 0)
  const totalTranslatedFiles = Array.from(filesByLocale.values()).reduce((sum, locale) => sum + locale.translated.length, 0)

  if (commits.length === 0) {
    log.error('No commits created', {
      senderId: options.senderId,
      seededFilesCount: totalSeededFiles,
      translatedFilesCount: totalTranslatedFiles,
      totalJobs: metadata.jobs.length
    })
    throw new Error('No file changes were produced for this translation job. Aborting pull request creation.')
  }

  // Prepare PR content with detailed information
  const prBase = pullRequestMetadata?.baseBranch ?? baseBranch
  const prTitle = pullRequestMetadata?.title
    ?? `🌐 Translation: ${sourceLocale} → ${targetLocales.join(', ')}`

  const prBody = pullRequestMetadata?.body ?? (() => {
    const commitDetails = commits.map((commit, index) => {
      const shortSha = commit.sha.substring(0, 7)
      return `${index + 1}. \`${shortSha}\` ${commit.message}`
    }).join('\n')

    const changesBreakdown = Object.keys(filesByType).map(type => {
      const count = filesByType[type].length
      let seededCount = 0
      let translatedCount = 0
      
      // Count files for this type across all locales
      for (const localeData of filesByLocale.values()) {
        seededCount += localeData.seeded.filter((f: { path: string }) => 
          f.path.includes(`/${type}/`) || f.path.startsWith(`${type}/`)
        ).length
        translatedCount += localeData.translated.filter((f: { path: string }) => 
          f.path.includes(`/${type}/`) || f.path.startsWith(`${type}/`)
        ).length
      }
      
      return `- **${type}**: ${count} source file${count !== 1 ? 's' : ''} → ${seededCount + translatedCount} locale file${seededCount + translatedCount !== 1 ? 's' : ''}`
    }).join('\n')

    return `## 🎯 Translation Summary

### Locales Processed
- **Source**: \`${sourceLocale}\`
- **Targets**: ${targetLocales.map(locale => `\`${locale}\``).join(', ')}

### Changes Overview
- **🌱 Seeded Files**: ${totalSeededFiles} (base content copied to target locales)
- **🔄 Translated Files**: ${totalTranslatedFiles} (automated translations applied)
- **📁 Total Changed Files**: ${totalSeededFiles + totalTranslatedFiles}

### File Breakdown by Type
${changesBreakdown}

### Commits in this PR
${commitDetails}

### Repository Details
- **Base Branch**: \`${prBase}\`
- **Feature Branch**: \`${branchName}\`
- **Base Commit**: \`${baseCommitSha.substring(0, 7)}\`

${issue.number > 0 ? `\n---\nCloses #${issue.number}` : ''}

---
*🤖 This PR was automatically generated by auto-i18n*`
  })()

  const pullRequest = options.dryRun
    ? { number: 0, url: '', html_url: '', head: { ref: branchName }, base: { ref: prBase } }
    : await client.createPullRequest({ owner, repo, title: prTitle, head: branchName, base: prBase, body: prBody })

  // Add labels to the pull request (labels are added via the issues API for PRs)
  if (!options.dryRun && pullRequest.number > 0) {
    const prLabels = ['i18n', 'translation', 'automated']
    if (targetLocales.length > 1) {
      prLabels.push('multi-locale')
    }
    if (totalTranslatedFiles > 0) {
      prLabels.push('ready-for-review')
    }
    
    try {
      await client.updatePullRequestLabels({
        owner,
        repo,
        pull_number: pullRequest.number,
        labels: prLabels
      })
    } catch (error) {
      log.warn('Failed to add labels to pull request', { 
        prNumber: pullRequest.number, 
        labels: prLabels,
        error 
      })
    }
  }

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
  translatedLocales: totalTranslatedFiles > 0 ? targetLocales.filter((locale) => locale !== sourceLocale) : [],
    issueNumber: issue.number,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url ?? '',
    commits
  }
}
