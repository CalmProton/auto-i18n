import { db, schema } from '../../../db'
import { eq } from 'drizzle-orm'

/**
 * GET /api/batch/by-id/:id
 * Get batch detail by batch's own ID (not session ID).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, id))
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })

  const requests = await db
    .select()
    .from(schema.batchRequests)
    .where(eq(schema.batchRequests.batchId, id))

  return {
    batch,
    requestCount: requests.length,
    pendingCount: requests.filter(r => r.status === 'pending').length,
    completedCount: requests.filter(r => r.status === 'completed').length,
    failedCount: requests.filter(r => r.status === 'failed').length,
  }
})
