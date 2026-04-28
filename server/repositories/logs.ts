import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

export type ApiRequestLog = InferSelectModel<typeof schema.apiRequestLogs>
export type NewApiRequestLog = InferInsertModel<typeof schema.apiRequestLogs>

export async function createLog(data: NewApiRequestLog): Promise<ApiRequestLog> {
  const [row] = await db.insert(schema.apiRequestLogs).values(data).returning()
  return row!
}

export async function getLogsBySession(sessionId: string): Promise<ApiRequestLog[]> {
  return db
    .select()
    .from(schema.apiRequestLogs)
    .where(eq(schema.apiRequestLogs.sessionId, sessionId))
    .orderBy(desc(schema.apiRequestLogs.createdAt))
}
