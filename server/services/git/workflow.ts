import { db, schema } from '../../db'
import { and, eq } from 'drizzle-orm'
import { getSetting } from '../../utils/getSetting'
import { GitHubForge } from './forges/github'
import { GitLabForge } from './forges/gitlab'
import { deliverViaWebhook } from './forges/webhook'
import { deliverNone } from './forges/none'
import type { GitForge, ForgeFile, ForgeWorkflowResult } from './types'

const { sessions, files, gitJobs } = schema

/**
 * Run the full git workflow for a session.
 * Selects the right forge based on GIT_FORGE setting, then:
 * 1. Creates a branch
 * 2. Pushes source files as a seed commit
 * 3. Pushes translated files as a translation commit
 * 4. Opens a PR/MR
 * Saves the result to the git_jobs table.
 */
export async function runGitWorkflow(sessionId: string): Promise<ForgeWorkflowResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const targetLocales: string[] = JSON.parse(session.targetLocales)
  const forge = (await getSetting('GIT_FORGE')) ?? 'none'

  // webhook and none modes bypass forge-specific logic
  if (forge === 'webhook') {
    const result = await deliverViaWebhook(sessionId, session.senderId, session.sourceLocale, targetLocales)
    await upsertGitJob(sessionId, forge, 'completed', result)
    return result
  }

  if (forge === 'none') {
    const result = await deliverNone(sessionId)
    await upsertGitJob(sessionId, forge, 'completed', result)
    return result
  }

  // github or gitlab — need repo info
  if (!session.repoOwner || !session.repoName || !session.repoBranch || !session.baseCommitSha) {
    throw new Error('Session missing required repo fields (repoOwner, repoName, repoBranch, baseCommitSha)')
  }

  const forgeImpl: GitForge = forge === 'gitlab' ? new GitLabForge() : new GitHubForge()

  // Generate branch name
  const branchName = `auto-i18n/${session.senderId.slice(0, 12)}-${Date.now().toString(36)}`

  // Optionally create an issue
  let issueNumber: number | undefined
  const createIssues = (await getSetting('GIT_CREATE_ISSUES')) === 'true'
  if (createIssues && forgeImpl.createIssue) {
    try {
      const issue = await forgeImpl.createIssue({
        title: `Translation: ${session.sourceLocale} → ${targetLocales.join(', ')}`,
        body: buildIssueBody(session.senderId, session.sourceLocale, targetLocales),
        repoOwner: session.repoOwner,
        repoName: session.repoName,
      })
      issueNumber = issue.number
    } catch (err) {
      console.warn(`[git-workflow] Issue creation failed (non-fatal):`, err)
    }
  }

  // Create branch from baseCommitSha
  await forgeImpl.createBranch(session.repoOwner, session.repoName, branchName, session.baseCommitSha)

  // Load source (upload) files and translated files
  const uploadedFiles = await db.select().from(files)
    .where(and(eq(files.sessionId, sessionId), eq(files.fileType, 'upload')))

  const translatedFiles = await db.select().from(files)
    .where(and(eq(files.sessionId, sessionId), eq(files.fileType, 'translation')))

  // Seed commit: source files copied to each target locale path
  const seedFiles: ForgeFile[] = []
  for (const f of uploadedFiles) {
    for (const targetLocale of targetLocales) {
      const targetPath = deriveTargetPath(f.filePath, session.sourceLocale, targetLocale, f.contentType)
      seedFiles.push({ path: targetPath, content: f.content })
    }
  }

  if (seedFiles.length > 0) {
    await forgeImpl.pushFiles(
      session.repoOwner,
      session.repoName,
      branchName,
      seedFiles,
      `chore(i18n): seed translations from ${session.sourceLocale}`,
    )
  }

  // Translation commit: actual translated content
  const translationForgeFiles: ForgeFile[] = translatedFiles.map(f => ({
    path: deriveTargetPath(f.filePath, session.sourceLocale, f.locale, f.contentType),
    content: f.content,
  }))

  if (translationForgeFiles.length === 0) {
    throw new Error('No translated files found — run translation before git finalize')
  }

  await forgeImpl.pushFiles(
    session.repoOwner,
    session.repoName,
    branchName,
    translationForgeFiles,
    `feat(i18n): apply translations for ${targetLocales.join(', ')}`,
  )

  // Create PR/MR
  const prBody = buildPRBody(session.senderId, session.sourceLocale, targetLocales, issueNumber)
  const pr = await forgeImpl.createPR({
    title: `Translation: ${session.sourceLocale} → ${targetLocales.join(', ')}`,
    body: prBody,
    head: branchName,
    base: session.repoBranch,
    repoOwner: session.repoOwner,
    repoName: session.repoName,
  })

  const result: ForgeWorkflowResult = {
    forge,
    branch: branchName,
    prNumber: pr.number,
    prUrl: pr.url,
    issueNumber,
  }

  await upsertGitJob(sessionId, forge, 'completed', result, branchName, pr.number, pr.url, issueNumber)
  return result
}

async function upsertGitJob(
  sessionId: string,
  forge: string,
  status: string,
  _result: ForgeWorkflowResult,
  branch?: string,
  prNumber?: number,
  prUrl?: string,
  issueNumber?: number,
): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(gitJobs).values({
    sessionId,
    forge,
    status,
    branch: branch ?? null,
    prNumber: prNumber ?? null,
    prUrl: prUrl ?? null,
    issueNumber: issueNumber ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: gitJobs.sessionId,
    set: {
      forge,
      status,
      branch: branch ?? null,
      prNumber: prNumber ?? null,
      prUrl: prUrl ?? null,
      issueNumber: issueNumber ?? null,
      updatedAt: now,
    },
  })
}

/**
 * Derive the target repo path for a translated file.
 * - For global/page JSON: replaces source locale in the filename
 * - For content markdown: replaces locale directory segment
 */
function deriveTargetPath(sourcePath: string, sourceLocale: string, targetLocale: string, contentType: string): string {
  if (contentType === 'global' || contentType === 'page') {
    // e.g. en.json → fr.json, or locales/en.json → locales/fr.json
    return sourcePath
      .replace(new RegExp(`\\b${escapeRegex(sourceLocale)}\\b`, 'g'), targetLocale)
  }
  // content markdown: replace locale directory segment
  if (sourcePath.includes(`/${sourceLocale}/`)) {
    return sourcePath.replace(`/${sourceLocale}/`, `/${targetLocale}/`)
  }
  if (sourcePath.includes(`.${sourceLocale}.`)) {
    return sourcePath.replace(`.${sourceLocale}.`, `.${targetLocale}.`)
  }
  // fallback: insert locale before filename
  const parts = sourcePath.split('/')
  const filename = parts.pop()!
  return [...parts, targetLocale, filename].join('/')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildIssueBody(senderId: string, sourceLocale: string, targetLocales: string[]): string {
  return `## Translation in Progress

**Sender ID:** \`${senderId}\`
**Source locale:** ${sourceLocale}
**Target locales:** ${targetLocales.join(', ')}

This issue will be closed when the translation PR is merged.`
}

function buildPRBody(
  senderId: string,
  sourceLocale: string,
  targetLocales: string[],
  issueNumber?: number,
): string {
  const lines = [
    `## Automated Translation`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Sender ID | \`${senderId}\` |`,
    `| Source locale | ${sourceLocale} |`,
    `| Target locales | ${targetLocales.join(', ')} |`,
    ``,
    `Generated by [auto-i18n](https://github.com/auto-i18n).`,
  ]
  if (issueNumber) {
    lines.push(``, `Closes #${issueNumber}`)
  }
  return lines.join('\n')
}
