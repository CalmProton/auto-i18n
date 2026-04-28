import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

export type Session = InferSelectModel<typeof schema.sessions>
export type NewSession = InferInsertModel<typeof schema.sessions>

export async function getSessionById(id: string): Promise<Session | null> {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id))
  return row ?? null
}

export async function getSessionBySenderId(senderId: string): Promise<Session | null> {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.senderId, senderId))
  return row ?? null
}

export async function createSession(data: NewSession): Promise<Session> {
  const [row] = await db.insert(schema.sessions).values(data).returning()
  return row!
}

export async function updateSession(
  id: string,
  data: Partial<Omit<Session, 'id' | 'createdAt'>>,
): Promise<Session | null> {
  const [row] = await db
    .update(schema.sessions)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.sessions.id, id))
    .returning()
  return row ?? null
}

export async function listSessions(limit = 50, offset = 0): Promise<Session[]> {
  return db
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function countSessions(): Promise<number> {
  const rows = await db.select().from(schema.sessions)
  return rows.length
}

export async function getSessionsByStatus(status: string): Promise<Session[]> {
  return db.select().from(schema.sessions).where(eq(schema.sessions.status, status))
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id))
}
