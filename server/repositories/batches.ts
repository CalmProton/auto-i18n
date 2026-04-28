import { db, schema } from '../db'
import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

export type Batch = InferSelectModel<typeof schema.batches>
export type BatchRequest = InferSelectModel<typeof schema.batchRequests>

export async function getBatchById(id: string): Promise<Batch | null> {
  const [row] = await db.select().from(schema.batches).where(eq(schema.batches.id, id))
  return row ?? null
}

export async function getBatchBySession(sessionId: string): Promise<Batch | null> {
  const [row] = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.sessionId, sessionId))
  return row ?? null
}

export async function getBatchesByStatus(status: string): Promise<Batch[]> {
  return db.select().from(schema.batches).where(eq(schema.batches.status, status))
}

export async function updateBatch(
  id: string,
  data: Partial<Omit<Batch, 'id' | 'createdAt'>>,
): Promise<Batch | null> {
  const [row] = await db
    .update(schema.batches)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.batches.id, id))
    .returning()
  return row ?? null
}

export async function getBatchRequestsByBatch(batchId: string): Promise<BatchRequest[]> {
  return db
    .select()
    .from(schema.batchRequests)
    .where(eq(schema.batchRequests.batchId, batchId))
}
