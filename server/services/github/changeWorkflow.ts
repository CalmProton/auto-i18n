/**
 * GitHub workflow for creating pull requests from change sessions
 * Handles incremental translation changes
 */

import { createScopedLogger } from '../../utils/logger'
import { loadChangeSession } from '../../utils/changeStorage'
import { GitHubClient } from './client'
import { getGitHubConfig } from '../../config/github'
import type { ChangeSessionMetadata } from '../../types'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const log = createScopedLogger('services:github:changeWorkflow')

const TMP_DIR = join(process.cwd(), 'tmp')

interface CreateChangePROptions {
  sessionId: string
  dryRun?: boolean
}

interface CreateChangePRResult {
  issueNumber: number
  issueUrl: string
  branchName: string
  pullRequestNumber: number
  pullRequestUrl: string
  commitSha: string
  filesChanged: number
  localesProcessed: string[]
}

/**
 * Get all translation files for a change session
 */
function getTranslationFiles(sessionId: string): Array<{
  locale: string
  type: string
  fileName: string
  filePath: string
  content: string
}> {
  const translationsPath = join(TMP_DIR, sessionId, 'translations')
  
  if (!existsSync(translationsPath)) {
    return []
  }

  const files: Array<{
    locale: string
    type: string
    fileName: string
    filePath: string
    content: string
  }> = []

  const locales = readdirSync(translationsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const locale of locales) {
    const localePath = join(translationsPath, locale)
    
    // Check for global (JSON) files
    const globalPath = join(localePath, 'global')
    if (existsSync(globalPath)) {
      const jsonFiles = readdirSync(globalPath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.json'))

      for (const file of jsonFiles) {
        const filePath = join(globalPath, file.name)
        const content = readFileSync(filePath, 'utf-8')
        files.push({
          locale,
          type: 'global',
          fileName: file.name,
          filePath,
          content
        })
      }
    }

    // Check for page (JSON) files
    const pagePath = join(localePath, 'page')
    if (existsSync(pagePath)) {
      const jsonFiles = readdirSync(pagePath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.json'))

      for (const file of jsonFiles) {
        const filePath = join(pagePath, file.name)
        const content = readFileSync(filePath, 'utf-8')
        files.push({
          locale,
          type: 'page',
          fileName: file.name,
          filePath,
          content
        })
      }
    }

    // Check for content (markdown) files
    const contentPath = join(localePath, 'content')
    if (existsSync(contentPath)) {
      // Recursively collect markdown files
      const collectMarkdownFiles = (dir: string, relativePath = ''): void => {
        const entries = readdirSync(dir, { withFileTypes: true })
        
        for (const entry of entries) {
          const fullPath = join(dir, entry.name)
          const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
          
          if (entry.isDirectory()) {
            collectMarkdownFiles(fullPath, relPath)
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = readFileSync(fullPath, 'utf-8')
            files.push({
              locale,
              type: 'content',
              fileName: relPath,
              filePath: fullPath,
              content
            })
          }
        }
      }

      collectMarkdownFiles(contentPath)
    }
  }

  return files
}

/**
 * Create a pull request from a change session
 */
export async function createChangePR(options: CreateChangePROptions): Promise<CreateChangePRResult> {
  const { sessionId, dryRun = false } = options

  log.info('Creating pull request for change session', { sessionId, dryRun })

  // Load change session metadata
  const metadata = await loadChangeSession(sessionId)
  if (!metadata) {
    throw new Error(`Change session ${sessionId} not found`)
  }

  if (metadata.status !== 'completed') {
    throw new Error(`Change session ${sessionId} is not completed (status: ${metadata.status})`)
  }

  // Get translation files
  const translationFiles = getTranslationFiles(sessionId)
  if (translationFiles.length === 0) {
    throw new Error(`No translation files found for change session ${sessionId}`)
  }

  log.info('Found translation files', {
    sessionId,
    fileCount: translationFiles.length,
    locales: [...new Set(translationFiles.map(f => f.locale))]
  })

  // Initialize GitHub client
  const client = new GitHubClient()

  const { repository } = metadata

  // Prepare branch name and PR details
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const branchName = `auto-i18n/changes-${sessionId.substring(0, 15)}-${timestamp}`
  
  const changeCount = metadata.changes.length
  const addedCount = metadata.changes.filter(c => c.changeType === 'added').length
  const modifiedCount = metadata.changes.filter(c => c.changeType === 'modified').length
  const deletedCount = metadata.changes.filter(c => c.changeType === 'deleted').length

  const issueTitle = `🌐 Translation Update: ${changeCount} changes to ${metadata.targetLocales.join(', ')}`
  const issueBody = `## Incremental Translation Update

This is an automated translation update for recent changes to the ${metadata.sourceLocale} content.

### Changes Summary
- **Added**: ${addedCount} files
- **Modified**: ${modifiedCount} files  
- **Deleted**: ${deletedCount} files
- **Total**: ${changeCount} changes

### Target Locales
${metadata.targetLocales.map(locale => `- ${locale}`).join('\n')}

### Source Commit
- **SHA**: ${metadata.repository.commitSha}
- **Message**: ${metadata.commit.message}
- **Author**: ${metadata.commit.author}
- **Date**: ${metadata.commit.timestamp}

### Translation Details
- **Files Translated**: ${translationFiles.length}
- **Session ID**: ${sessionId}
- **Automation Mode**: ${metadata.automationMode}

---
*This update was automatically generated by [auto-i18n](https://github.com/CalmProton/auto-i18n)*`

  if (dryRun) {
    log.info('Dry run: Would create PR with details', {
      sessionId,
      branchName,
      issueTitle,
      fileCount: translationFiles.length,
      locales: [...new Set(translationFiles.map(f => f.locale))]
    })

    return {
      issueNumber: 0,
      issueUrl: 'dry-run',
      branchName,
      pullRequestNumber: 0,
      pullRequestUrl: 'dry-run',
      commitSha: 'dry-run',
      filesChanged: translationFiles.length,
      localesProcessed: [...new Set(translationFiles.map(f => f.locale))]
    }
  }

  // Step 1: Create GitHub issue
  log.info('Creating GitHub issue', { sessionId })
  const issue = await client.createIssue({
    owner: repository.owner,
    repo: repository.name,
    title: issueTitle,
    body: issueBody,
    labels: ['auto-i18n', 'translation', 'incremental-update']
  })

  log.info('Created GitHub issue', {
    sessionId,
    issueNumber: issue.number,
    issueUrl: issue.html_url
  })

  // Step 2: Create branch
  log.info('Creating branch', { sessionId, branchName, baseBranch: repository.baseBranch })
  
  // Check if branch exists
  const branchExists = await client.refExists(repository.owner, repository.name, `heads/${branchName}`)
  let baseSha: string
  
  if (!branchExists) {
    // Get base branch SHA
    const baseRef = await client.getRef(repository.owner, repository.name, `heads/${repository.baseBranch}`)
    baseSha = baseRef.object.sha
    
    // Create branch
    await client.createRef(repository.owner, repository.name, `heads/${branchName}`, baseSha)
    log.info('Created branch', { sessionId, branchName, baseSha })
  } else {
    // Use existing branch
    const existingRef = await client.getRef(repository.owner, repository.name, `heads/${branchName}`)
    baseSha = existingRef.object.sha
    log.info('Branch already exists, using existing branch', { sessionId, branchName, baseSha })
  }

  // Step 3: Commit translation files
  const commitMessage = `🌐 Update translations for ${metadata.targetLocales.join(', ')}\n\n${changeCount} changes from commit ${metadata.repository.commitSha.substring(0, 7)}\n\nResolves #${issue.number}`

  // Group files by locale and type for organized commits
  const filesByLocale = translationFiles.reduce((acc, file) => {
    if (!acc[file.locale]) {
      acc[file.locale] = []
    }
    acc[file.locale].push(file)
    return acc
  }, {} as Record<string, typeof translationFiles>)

  // Determine target paths based on repository structure
  // Use metadata's targetPathPattern if available, otherwise use default
  const getTargetPath = (locale: string, type: string, fileName: string): string => {
    // Default pattern for most repos
    if (type === 'content') {
      return `i18n/${locale}/${fileName}`
    } else if (type === 'global') {
      return `locales/${locale}/${fileName}`
    } else if (type === 'page') {
      return `locales/${locale}/${fileName}`
    }
    return `${type}/${locale}/${fileName}`
  }

  // Prepare file changes
  const fileChanges = translationFiles.map(file => ({
    path: getTargetPath(file.locale, file.type, file.fileName),
    content: file.content
  }))

  log.info('Committing translation files', {
    sessionId,
    fileCount: fileChanges.length,
    locales: Object.keys(filesByLocale)
  })

  // Get current tree SHA
  const currentRef = await client.getRef(repository.owner, repository.name, `heads/${branchName}`)
  const currentCommit = await client.getCommit(repository.owner, repository.name, currentRef.object.sha)
  const baseTreeSha = currentCommit.tree.sha

  // Create blobs and tree entries
  const treeEntries = []
  for (const file of fileChanges) {
    const blob = await client.createBlob(repository.owner, repository.name, file.content)
    treeEntries.push({
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blob.sha
    })
  }

  // Create tree
  const tree = await client.createTree(repository.owner, repository.name, treeEntries, baseTreeSha)
  
  // Create commit
  const commit = await client.createCommit(
    repository.owner,
    repository.name,
    commitMessage,
    tree.sha,
    [currentRef.object.sha]
  )

  // Update branch reference
  await client.updateRef(repository.owner, repository.name, `heads/${branchName}`, commit.sha)

  log.info('Created commit', { sessionId, commitSha: commit.sha })

  // Step 4: Create pull request
  const prTitle = issueTitle
  const prBody = `${issueBody}\n\n---\n\n**Issue**: #${issue.number}`

  log.info('Creating pull request', { sessionId, branchName, baseBranch: repository.baseBranch })

  const pr = await client.createPullRequest({
    owner: repository.owner,
    repo: repository.name,
    title: prTitle,
    body: prBody,
    head: branchName,
    base: repository.baseBranch
  })

  log.info('✅ Created pull request for change session', {
    sessionId,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.html_url,
    filesChanged: translationFiles.length,
    locales: Object.keys(filesByLocale)
  })

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    branchName,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.html_url,
    commitSha: commit.sha,
    filesChanged: translationFiles.length,
    localesProcessed: Object.keys(filesByLocale)
  }
}
