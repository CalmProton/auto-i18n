import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

export type GitJob = InferSelectModel<typeof schema.gitJobs>

export async function getGitJobBySession(sessionId: string): Promise<GitJob | null> {
  const [row] = await db
    .select()
    .from(schema.gitJobs)
    .where(eq(schema.gitJobs.sessionId, sessionId))
  return row ?? null
}

export async function listGitJobs(limit = 50, offset = 0): Promise<GitJob[]> {
  return db
    .select()
    .from(schema.gitJobs)
    .orderBy(desc(schema.gitJobs.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function getSessionsReadyForGit(): Promise<{ sessionId: string; status: string; forge: string }[]> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      senderId: schema.sessions.senderId,
      status: schema.sessions.status,
      targetLocales: schema.sessions.targetLocales,
      sourceLocale: schema.sessions.sourceLocale,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.status, 'completed'))
    .orderBy(desc(schema.sessions.createdAt))
    .limit(100)

  // Check which ones don't have git jobs yet
  const ready: { sessionId: string; senderId: string; status: string }[] = []
  for (const s of rows) {
    const count = await db
      .select()
      .from(schema.gitJobs)
      .where(eq(schema.gitJobs.sessionId, s.id))
    if (count.length === 0) {
      ready.push(s)
    }
  }

  return ready as any
}
