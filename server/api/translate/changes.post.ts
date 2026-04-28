import { requireValidLocale, parseLocaleArray } from '../../utils/locales'
import { getSessionBySenderId, createSession, updateSession } from '../../repositories/sessions'
import { createFile } from '../../repositories/files'
import { getBatchProviderName } from '../../services/translation'
import { createBatchFromSession, submitBatch } from '../../services/translation/batchService'
import { enqueueJob } from '../../queue'
import { eventStart } from '../../repositories/events'

interface ChangeFile {
  path: string
  content: string
  format: 'markdown' | 'json'
  contentType: 'content' | 'global' | 'page'
}

interface ChangesBody {
  senderId: string
  sourceLocale: string
  targetLocales: string | string[]
  mode?: 'auto' | 'realtime' | 'batch'
  repoOwner?: string
  repoName?: string
  repoBranch?: string
  baseCommitSha?: string
  files: ChangeFile[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ChangesBody>(event)

  if (!body?.senderId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'senderId is required' })
  }
  if (!body.files?.length) {
    throw createError({ statusCode: 400, statusMessage: 'files array is required and must not be empty' })
  }

  const sourceLocale = requireValidLocale(body.sourceLocale)
  const rawTargets = typeof body.targetLocales === 'string'
    ? JSON.parse(body.targetLocales)
    : body.targetLocales
  const targetLocales = parseLocaleArray(rawTargets).filter(l => l !== sourceLocale)
  if (targetLocales.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'targetLocales must contain at least one locale different from sourceLocale' })
  }

  const senderId = body.senderId.trim()

  const existing = await getSessionBySenderId(senderId)
  if (existing) {
    return { sessionId: existing.id, senderId, resumed: true, status: existing.status }
  }

  const session = await createSession({
    senderId,
    sessionType: 'changes',
    status: 'processing',
    sourceLocale,
    targetLocales: JSON.stringify(targetLocales),
    repoOwner: body.repoOwner ?? null,
    repoName: body.repoName ?? null,
    repoBranch: body.repoBranch ?? null,
    baseCommitSha: body.baseCommitSha ?? null,
  })

  await eventStart(session.id, 'upload', { fileCount: body.files.length, targetLocales })

  for (const f of body.files) {
    if (!f.path || typeof f.content !== 'string') continue
    const format = f.format === 'json' ? 'json' : 'markdown'
    const contentType = (['global', 'page', 'content'] as const).includes(f.contentType as any)
      ? (f.contentType as 'global' | 'page' | 'content')
      : 'content'

    // Store as 'upload' so batchService and queue handlers can find them
    // (sessionType='changes' distinguishes these from full uploads)
    await createFile({
      sessionId: session.id,
      fileType: 'upload',
      contentType,
      format,
      locale: sourceLocale,
      filePath: f.path,
      content: f.content,
    })
  }

  const mode = body.mode ?? 'auto'
  const batchProvider = await getBatchProviderName()
  const useBatch = mode === 'batch' || (mode === 'auto' && batchProvider !== null)

  try {
    if (useBatch) {
      const batchDbId = await createBatchFromSession(session.id)
      const externalId = await submitBatch(batchDbId)
      await eventStart(session.id, 'batch-submit', { batchDbId, externalId })
      await enqueueJob(session.id, 'batch-poll', undefined, new Date(Date.now() + 30_000))
    } else {
      await enqueueJob(session.id, 'realtime-translate')
    }
  } catch (err) {
    await updateSession(session.id, { status: 'failed' })
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to enqueue translation: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return {
    sessionId: session.id,
    senderId,
    resumed: false,
    status: 'processing',
    mode: useBatch ? 'batch' : 'realtime',
    targetLocales,
  }
})
