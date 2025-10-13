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

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge(target: any, source: any): any {
  if (typeof target !== 'object' || target === null) {
    return source
  }
  if (typeof source !== 'object' || source === null) {
    return target
  }

  const result = { ...target }
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key], source[key])
      } else {
        result[key] = source[key]
      }
    }
  }
  
  return result
}

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
  // If PR already exists, reuse that branch. Otherwise create new one with timestamp
  let branchName: string
  
  if (metadata.steps.prCreated?.completed && metadata.steps.prCreated?.branchName) {
    // Reuse existing branch to update the same PR
    branchName = metadata.steps.prCreated.branchName
    log.info('Reusing existing branch', { sessionId, branchName })
  } else {
    // Create new branch with unique timestamp
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const timeComponent = Date.now().toString().slice(-6) // Last 6 digits for uniqueness
    branchName = `auto-i18n/changes-${sessionId.substring(0, 15)}-${timestamp}-${timeComponent}`
    log.info('Creating new branch', { sessionId, branchName })
  }
  
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

  // Determine target paths based on the original file paths from metadata
  const getTargetPath = (locale: string, type: string, fileName: string): string => {
    // fileName is the target locale filename (e.g., ar.json)
    // We need to find the source file by matching on type only (for global files there's usually just one)
    const originalChange = metadata.changes?.find(c => c.type === type)
    
    if (originalChange?.path) {
      // Use the original path structure, but replace the source locale filename with target locale
      // For example: "i18n/locales/en.json" -> "i18n/locales/ru.json"
      const pathParts = originalChange.path.split('/')
      const sourceFileName = pathParts[pathParts.length - 1]
      
      // Replace source locale filename with target locale filename
      // For global files: en.json -> ru.json
      // For content/page files: keep the structure but in the target locale folder
      if (type === 'global') {
        // Replace the last part (filename) with target locale filename
        pathParts[pathParts.length - 1] = fileName
        return pathParts.join('/')
      } else {
        // For content/page files, replace the locale folder
        // e.g., i18n/en/content/page.md -> i18n/ru/content/page.md
        const localeIndex = pathParts.findIndex(part => part === metadata.sourceLocale)
        if (localeIndex !== -1) {
          pathParts[localeIndex] = locale
        }
        return pathParts.join('/')
      }
    }
    
    // Fallback to default pattern
    if (type === 'content') {
      return `i18n/${locale}/${fileName}`
    } else if (type === 'global') {
      return `locales/${locale}/${fileName.replace(/^[a-z]{2}\.json$/, `${locale}.json`)}`
    } else if (type === 'page') {
      return `locales/${locale}/${fileName}`
    }
    return `${type}/${locale}/${fileName}`
  }

  // Prepare file changes by merging deltas with existing files
  const fileChanges: Array<{ path: string; content: string }> = []
  
  for (const file of translationFiles) {
    const targetPath = getTargetPath(file.locale, file.type, file.fileName)
    
    // For JSON files (global/page), merge the delta with existing content
    if (file.type === 'global' || file.type === 'page') {
      try {
        // Fetch existing file from GitHub
        const existingContent = await client.getFileContent(
          repository.owner,
          repository.name,
          targetPath,
          repository.baseBranch
        )
        
        // Parse existing and delta JSON
        const existing = JSON.parse(existingContent)
        const delta = JSON.parse(file.content)
        
        // Merge delta into existing (deep merge for nested objects)
        const merged = deepMerge(existing, delta)
        
        fileChanges.push({
          path: targetPath,
          content: JSON.stringify(merged, null, 2)
        })
        
        log.debug('Merged delta with existing file', {
          targetPath,
          existingKeys: Object.keys(existing).length,
          deltaKeys: Object.keys(delta).length,
          mergedKeys: Object.keys(merged).length
        })
      } catch (error) {
        // File doesn't exist yet, use delta as-is
        log.warn('Target file does not exist, using delta as-is', { targetPath, error })
        fileChanges.push({
          path: targetPath,
          content: file.content
        })
      }
    } else {
      // For markdown files, use content as-is (they're complete files, not deltas)
      fileChanges.push({
        path: targetPath,
        content: file.content
      })
    }
  }

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

  // Step 4: Create or update pull request
  let pr: { number: number; html_url: string }
  
  // Check if PR already exists (from previous attempt)
  if (metadata.steps.prCreated?.completed && metadata.steps.prCreated?.pullRequestNumber) {
    // PR already exists, just update it with the new commit (already done via commit above)
    pr = {
      number: metadata.steps.prCreated.pullRequestNumber,
      html_url: metadata.steps.prCreated.pullRequestUrl || ''
    }
    
    log.info('✅ Updated existing pull request with new commit', {
      sessionId,
      pullRequestNumber: pr.number,
      pullRequestUrl: pr.html_url,
      commitSha: commit.sha,
      filesChanged: translationFiles.length
    })
  } else {
    // Create new pull request
    const prTitle = issueTitle
    const prBody = `${issueBody}\n\n---\n\n**Issue**: #${issue.number}`

    log.info('Creating pull request', { sessionId, branchName, baseBranch: repository.baseBranch })

    pr = await client.createPullRequest({
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
  }

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
