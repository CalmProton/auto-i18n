import { db, schema } from '../../../db'
import { eq } from 'drizzle-orm'

/**
 * DELETE /api/batch/by-id/:id
 * Delete a batch by its own ID.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, id))
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })

  // Delete batch_requests first (cascade would handle this, but explicit is safer)
  await db.delete(schema.batchRequests).where(eq(schema.batchRequests.batchId, id))
  await db.delete(schema.batches).where(eq(schema.batches.id, id))

  return { deleted: id }
})
