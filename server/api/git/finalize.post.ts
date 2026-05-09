import { getSessionsByStatus } from '../../repositories/sessions'
import { enqueueJob } from '../../queue'

/**
 * POST /api/git/finalize
 * Trigger git forge output for all completed upload sessions that don't have git jobs yet.
 * Body (optional): { sessionId?: string } — if provided, finalize only that session.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: string }>(event)

  if (body?.sessionId) {
    const jobId = await enqueueJob(body.sessionId, 'git-finalize')
    return { finalized: [body.sessionId], jobIds: [jobId] }
  }

  // Finalize all completed sessions
  const completed = await getSessionsByStatus('completed')
  const jobIds: string[] = []

  for (const session of completed) {
    const jid = await enqueueJob(session.id, 'git-finalize')
    jobIds.push(jid)
  }

  return { finalized: completed.map(s => s.id), jobIds }
})
