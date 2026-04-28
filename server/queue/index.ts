/**
 * In-process job queue — persists jobs to SQLite, survives Nitro HMR via globalThis.
 *
 * Job types:
 *  - realtime-translate  translate files with OpenRouter in-process
 *  - batch-poll          check batch API for status, re-enqueue or proceed
 *  - batch-process       download + save batch output translations
 *  - git-finalize        run the git forge workflow (create branch, PR, etc.)
 *  - cleanup             delete old sessions/files past retention window
 */
import { db, schema } from '../db'
import { eq, and, lte } from 'drizzle-orm'
import { publish } from '../utils/sse'
import { processBatchOutput } from '../services/translation/batchService'
import { runGitWorkflow } from '../services/git/workflow'
import { getRealtimeProvider } from '../services/translation'
import { getFilesByType, upsertFile } from '../repositories/files'
import { getSessionById, updateSession } from '../repositories/sessions'
import { getBatchBySession, updateBatch } from '../repositories/batches'
import { pollOpenAIBatch } from '../services/translation/providers/openai-batch'
import { pollAnthropicBatch } from '../services/translation/providers/anthropic-batch'
import { eventStart, eventComplete, eventFail } from '../repositories/events'

const { jobs } = schema
type Job = typeof jobs.$inferSelect

// ── Global queue state (survives HMR) ─────────────────────────────────────────

interface QueueState {
  running: boolean
  timer: ReturnType<typeof setTimeout> | null
}

declare global {
  // eslint-disable-next-line no-var
  var __autoI18nQueue__: QueueState | undefined
}

function getState(): QueueState {
  if (!globalThis.__autoI18nQueue__) {
    globalThis.__autoI18nQueue__ = { running: false, timer: null }
  }
  return globalThis.__autoI18nQueue__
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called during bootstrap. Resets zombie jobs ('running' after a crash) back to
 * 'pending' and starts the polling loop.
 */
export async function bootRecover(): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'pending', heartbeatAt: null })
    .where(eq(jobs.status, 'running'))

  startQueue()
  console.log('[queue] started (bootRecover complete)')
}

/**
 * Enqueue a new background job.
 * @param sessionId  owning session
 * @param jobType    handler to invoke
 * @param payload    arbitrary JSON passed to handler
 * @param runAfter   earliest time to execute (default: now)
 */
export async function enqueueJob(
  sessionId: string,
  jobType: string,
  payload?: unknown,
  runAfter?: Date,
): Promise<string> {
  const [job] = await db
    .insert(jobs)
    .values({
      sessionId,
      jobType,
      status: 'pending',
      payload: payload ? JSON.stringify(payload) : null,
      runAfter: runAfter?.toISOString() ?? new Date().toISOString(),
    })
    .returning()
  return job!.id
}

/** Stop the queue loop (called on graceful shutdown). */
export function stopQueue(): void {
  const state = getState()
  state.running = false
  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  console.log('[queue] stopped')
}

// ── Queue loop ────────────────────────────────────────────────────────────────

function startQueue(): void {
  const state = getState()
  // On HMR: clear old timer before starting fresh
  if (state.timer) clearTimeout(state.timer)
  state.running = true
  scheduleNext(0)
}

function scheduleNext(delayMs = 5_000): void {
  const state = getState()
  if (!state.running) return
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(processJobs, delayMs)
}

async function processJobs(): Promise<void> {
  const state = getState()
  if (!state.running) return

  try {
    const now = new Date().toISOString()
    // Pick up to 3 pending jobs whose runAfter has passed
    const pendingJobs = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.runAfter, now)))
      .limit(3)

    for (const job of pendingJobs) {
      await runJob(job).catch((err) =>
        console.error(`[queue] runJob ${job.id} (${job.jobType}) threw:`, err),
      )
    }
  } catch (err) {
    console.error('[queue] processJobs error:', err)
  } finally {
    scheduleNext()
  }
}

async function runJob(job: Job): Promise<void> {
  // Atomically claim the job — prevents double-execution in case of re-entrant ticks
  const now = new Date().toISOString()
  await db
    .update(jobs)
    .set({ status: 'running', heartbeatAt: now, attempts: job.attempts + 1 })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending')))

  // Confirm we claimed it
  const [claimed] = await db.select().from(jobs).where(eq(jobs.id, job.id))
  if (!claimed || claimed.status !== 'running') return

  try {
    await executeJob(claimed)
    await db.update(jobs).set({ status: 'completed' }).where(eq(jobs.id, claimed.id))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const attempts = claimed.attempts
    if (attempts >= claimed.maxAttempts) {
      await db.update(jobs).set({ status: 'failed', error }).where(eq(jobs.id, claimed.id))
      console.error(`[queue] job ${claimed.id} (${claimed.jobType}) permanently failed:`, error)
    } else {
      // Exponential backoff: 30 s, 60 s, 120 s
      const delay = Math.pow(2, attempts - 1) * 30_000
      const retryAt = new Date(Date.now() + delay).toISOString()
      await db
        .update(jobs)
        .set({ status: 'pending', error, runAfter: retryAt })
        .where(eq(jobs.id, claimed.id))
      console.warn(`[queue] job ${claimed.id} (${claimed.jobType}) retry at ${retryAt}`)
    }
    throw err
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function executeJob(job: Job): Promise<void> {
  switch (job.jobType) {
    case 'realtime-translate': return handleRealtimeTranslate(job)
    case 'batch-poll':         return handleBatchPoll(job)
    case 'batch-process':      return handleBatchProcess(job)
    case 'git-finalize':       return handleGitFinalize(job)
    case 'cleanup':            return handleCleanup(job)
    default: throw new Error(`Unknown job type: ${job.jobType}`)
  }
}

// ── realtime-translate ────────────────────────────────────────────────────────

async function handleRealtimeTranslate(job: Job): Promise<void> {
  const { sessionId } = job
  const t0 = Date.now()
  await eventStart(sessionId, 'translate')

  const session = await getSessionById(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const targetLocales: string[] = JSON.parse(session.targetLocales)
  const uploadedFiles = await getFilesByType(sessionId, 'upload')
  if (uploadedFiles.length === 0) throw new Error('No uploaded files for realtime translate')

  const provider = await getRealtimeProvider()
  let errCount = 0

  for (const file of uploadedFiles) {
    for (const targetLocale of targetLocales) {
      if (targetLocale === session.sourceLocale) continue
      try {
        let translated: string
        if (file.format === 'markdown') {
          translated = await provider.translateMarkdown(file.content, {
            sourceLocale: session.sourceLocale,
            targetLocale,
            sessionId,
          })
        } else {
          const parsed = JSON.parse(file.content)
          const result = await provider.translateJson(parsed, {
            sourceLocale: session.sourceLocale,
            targetLocale,
            sessionId,
          })
          translated = JSON.stringify(result, null, 2)
        }

        await upsertFile({
          sessionId,
          fileType: 'translation',
          contentType: file.contentType,
          format: file.format,
          locale: targetLocale,
          filePath: file.filePath,
          content: translated,
        })

        publish(session.senderId, {
          type: 'translation-progress',
          data: { filePath: file.filePath, targetLocale, status: 'completed' },
        })
      } catch (err) {
        errCount++
        console.error(`[queue] translate ${file.filePath} → ${targetLocale}:`, err)
        publish(session.senderId, {
          type: 'translation-progress',
          data: { filePath: file.filePath, targetLocale, status: 'failed', error: String(err) },
        })
      }
    }
  }

  await eventComplete(sessionId, 'translate', Date.now() - t0, { errCount })

  // Hand off to git
  await enqueueJob(sessionId, 'git-finalize')

  publish(session.senderId, { type: 'translate-done', data: { sessionId, errCount } })
}

// ── batch-poll ────────────────────────────────────────────────────────────────

async function handleBatchPoll(job: Job): Promise<void> {
  const { sessionId } = job

  const batch = await getBatchBySession(sessionId)
  if (!batch?.externalBatchId) throw new Error(`No submitted batch for session ${sessionId}`)

  let pollResult: { status: string; completed: number; failed: number; total: number }

  if (batch.provider === 'openai') {
    pollResult = await pollOpenAIBatch(batch.externalBatchId)
  } else if (batch.provider === 'anthropic') {
    pollResult = await pollAnthropicBatch(batch.externalBatchId)
  } else {
    throw new Error(`Unknown batch provider: ${batch.provider}`)
  }

  // Normalize provider-specific status to our internal statuses
  const isDone = pollResult.status === 'completed' || pollResult.status === 'ended'
  await updateBatch(batch.id, {
    completed: pollResult.completed,
    failed: pollResult.failed,
    status: isDone ? 'processing' : 'submitted',
  })

  const session = await getSessionById(sessionId)
  if (session) {
    publish(session.senderId, { type: 'batch-progress', data: { ...pollResult, batchId: batch.id } })
  }

  if (isDone) {
    await enqueueJob(sessionId, 'batch-process', { batchDbId: batch.id })
  } else {
    // Re-poll in 2 minutes
    await enqueueJob(sessionId, 'batch-poll', undefined, new Date(Date.now() + 2 * 60_000))
  }
}

// ── batch-process ─────────────────────────────────────────────────────────────

async function handleBatchProcess(job: Job): Promise<void> {
  const { sessionId } = job
  const t0 = Date.now()
  await eventStart(sessionId, 'batch-process')

  const payload = job.payload ? JSON.parse(job.payload) : {}
  const batch = await getBatchBySession(sessionId)
  const batchDbId: string | undefined = payload.batchDbId ?? batch?.id
  if (!batchDbId) throw new Error(`No batch found for session ${sessionId}`)

  await processBatchOutput(batchDbId)
  await eventComplete(sessionId, 'batch-process', Date.now() - t0)

  const session = await getSessionById(sessionId)
  if (session) {
    publish(session.senderId, { type: 'batch-done', data: { sessionId } })
  }

  await enqueueJob(sessionId, 'git-finalize')
}

// ── git-finalize ──────────────────────────────────────────────────────────────

async function handleGitFinalize(job: Job): Promise<void> {
  const { sessionId } = job
  const t0 = Date.now()
  await eventStart(sessionId, 'git-pr')

  try {
    const result = await runGitWorkflow(sessionId)
    await updateSession(sessionId, { status: 'completed' })
    await eventComplete(sessionId, 'git-pr', Date.now() - t0, result)

    const session = await getSessionById(sessionId)
    if (session) {
      publish(session.senderId, { type: 'completed', data: { sessionId, ...result } })
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await updateSession(sessionId, { status: 'failed' })
    await eventFail(sessionId, 'git-pr', Date.now() - t0, error)

    const session = await getSessionById(sessionId)
    if (session) {
      publish(session.senderId, { type: 'failed', data: { sessionId, error } })
    }
    throw err
  }
}

// ── cleanup ───────────────────────────────────────────────────────────────────

async function handleCleanup(job: Job): Promise<void> {
  const { sessionId } = job
  const payload = job.payload ? JSON.parse(job.payload) : {}
  const retentionDays: number = payload.retentionDays ?? 30

  if (!sessionId) return

  const session = await getSessionById(sessionId)
  if (!session) return
  if (session.status !== 'completed' && session.status !== 'failed') return

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  if (session.createdAt >= cutoff) return

  const { deleteSession } = await import('../repositories/sessions')
  await deleteSession(sessionId)
  console.log(`[queue] cleaned up session ${sessionId}`)
}
