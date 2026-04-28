import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async () => {
  const sessions = await db
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(200)

  const byStatus: Record<string, number> = {}
  for (const s of sessions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
  }

  const recent = sessions.slice(0, 10)

  const totalJobs = await db.select().from(schema.jobs)
  const pendingJobs = totalJobs.filter(j => j.status === 'pending').length
  const runningJobs = totalJobs.filter(j => j.status === 'running').length
  const failedJobs = totalJobs.filter(j => j.status === 'failed').length

  return {
    sessionsByStatus: byStatus,
    totalSessions: sessions.length,
    recentSessions: recent,
    jobs: { pending: pendingJobs, running: runningJobs, failed: failedJobs },
  }
})
