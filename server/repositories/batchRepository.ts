/**
 * Batch Repository
 * Handles CRUD operations for OpenAI batch translation jobs using Drizzle ORM
 */
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { batches, batchRequests } from '../database/schema'
import type {
  Batch,
  NewBatch,
  BatchRequest,
  NewBatchRequest,
  BatchStatus,
  OpenAIBatchStatus,
  BatchRequestStatus,
  BatchManifest,
} from '../database/schema'
import { cacheGet, cacheSet, cacheDel } from '../cache/memory'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:batch')

// Cache TTL in seconds
const BATCH_CACHE_TTL = 60 // 1 minute (batches change frequently)

// ============================================================================
// TYPES
// ============================================================================

export type { Batch, BatchStatus, OpenAIBatchStatus, BatchManifest, BatchRequest, BatchRequestStatus }

export interface CreateBatchInput {
  batchId: string
  sessionId: string
  sourceLocale: string
  targetLocales: string[]
  contentTypes: string[]
  model: string
  totalRequests: number
  manifest: BatchManifest
}

export interface UpdateBatchInput {
  openaiBatchId?: string
  openaiStatus?: OpenAIBatchStatus
  completedRequests?: number
  failedRequests?: number
  status?: BatchStatus
  submittedAt?: Date
  completedAt?: Date
  errorMessage?: string
  manifest?: BatchManifest
}

export interface CreateBatchRequestInput {
  batchId: string // This is the string batchId, not UUID
  customId: string
  requestIndex: number
  fileId?: string
  relativePath: string
  targetLocale: string
  requestBody: Record<string, unknown>
}

export interface BatchFilter {
  sessionId?: string
  status?: BatchStatus
  openaiStatus?: OpenAIBatchStatus
  limit?: number
  offset?: number
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

function batchCacheKey(batchId: string): string {
  return `batch:${batchId}`
}

async function invalidateBatchCache(batchId: string): Promise<void> {
  await cacheDel(batchCacheKey(batchId))
}

// ============================================================================
// BATCH REPOSITORY METHODS
// ============================================================================

/**
 * Create a new batch
 */
export async function createBatch(input: CreateBatchInput): Promise<Batch> {
  const db = getDatabase()

  const [batch] = await db
    .insert(batches)
    .values({
      batchId: input.batchId,
      sessionId: input.sessionId,
      sourceLocale: input.sourceLocale,
      targetLocales: input.targetLocales,
      contentTypes: input.contentTypes,
      model: input.model,
      totalRequests: input.totalRequests,
      manifest: input.manifest,
    })
    .returning()

  log.info('Created batch', { batchId: batch.batchId, sessionId: batch.sessionId })

  return batch
}

/**
 * Get a batch by batch ID
 */
export async function getBatchByBatchId(batchId: string): Promise<Batch | null> {
  // Check cache first
  const cached = await cacheGet<Batch>(batchCacheKey(batchId), true)
  if (cached) {
    return cached
  }

  const db = getDatabase()
  const [batch] = await db
    .select()
    .from(batches)
    .where(eq(batches.batchId, batchId))
    .limit(1)

  if (!batch) {
    return null
  }

  // Cache the result
  await cacheSet(batchCacheKey(batchId), batch, BATCH_CACHE_TTL)

  return batch
}

/**
 * Get a batch by ID (UUID)
 */
export async function getBatchById(id: string): Promise<Batch | null> {
  const db = getDatabase()
  const [batch] = await db.select().from(batches).where(eq(batches.id, id)).limit(1)

  return batch || null
}

/**
 * Update a batch
 */
export async function updateBatch(batchId: string, input: UpdateBatchInput): Promise<Batch | null> {
  const db = getDatabase()

  // Build update object with only defined fields
  const updateData: Partial<NewBatch> = {}
  if (input.openaiBatchId !== undefined) updateData.openaiBatchId = input.openaiBatchId
  if (input.openaiStatus !== undefined) updateData.openaiStatus = input.openaiStatus
  if (input.completedRequests !== undefined) updateData.completedRequests = input.completedRequests
  if (input.failedRequests !== undefined) updateData.failedRequests = input.failedRequests
  if (input.status !== undefined) updateData.status = input.status
  if (input.submittedAt !== undefined) updateData.submittedAt = input.submittedAt
  if (input.completedAt !== undefined) updateData.completedAt = input.completedAt
  if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage
  if (input.manifest !== undefined) updateData.manifest = input.manifest

  const [batch] = await db
    .update(batches)
    .set(updateData)
    .where(eq(batches.batchId, batchId))
    .returning()

  if (!batch) {
    return null
  }

  // Invalidate cache
  await invalidateBatchCache(batchId)

  log.debug('Updated batch', { batchId, updates: Object.keys(input) })

  return batch
}

/**
 * Delete a batch by batch ID
 */
export async function deleteBatch(batchId: string): Promise<boolean> {
  const db = getDatabase()

  const result = await db
    .delete(batches)
    .where(eq(batches.batchId, batchId))
    .returning({ id: batches.id })

  if (result.length > 0) {
    await invalidateBatchCache(batchId)
    log.info('Deleted batch', { batchId })
    return true
  }

  return false
}

/**
 * List batches with optional filtering
 */
export async function listBatches(filter: BatchFilter = {}): Promise<Batch[]> {
  const db = getDatabase()
  const limit = filter.limit || 50
  const offset = filter.offset || 0

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(batches.sessionId, filter.sessionId))
  }
  if (filter.status) {
    conditions.push(eq(batches.status, filter.status))
  }
  if (filter.openaiStatus) {
    conditions.push(eq(batches.openaiStatus, filter.openaiStatus))
  }

  let query = db.select().from(batches)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  return query.orderBy(desc(batches.createdAt)).limit(limit).offset(offset)
}

/**
 * Count batches with optional filtering
 */
export async function countBatches(filter: BatchFilter = {}): Promise<number> {
  const db = getDatabase()

  const conditions = []

  if (filter.sessionId) {
    conditions.push(eq(batches.sessionId, filter.sessionId))
  }
  if (filter.status) {
    conditions.push(eq(batches.status, filter.status))
  }

  let query = db.select({ count: sql<number>`count(*)` }).from(batches)

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query
  }

  const [result] = await query

  return Number(result?.count || 0)
}

/**
 * Get pending batches (for polling)
 */
export async function getPendingBatches(): Promise<Batch[]> {
  const db = getDatabase()

  return db
    .select()
    .from(batches)
    .where(
      and(
        inArray(batches.status, ['submitted', 'processing']),
        sql`${batches.openaiStatus} NOT IN ('completed', 'failed', 'expired', 'cancelled')`
      )
    )
    .orderBy(asc(batches.submittedAt))
}

/**
 * Get batches for a session
 */
export async function getBatchesForSession(sessionId: string): Promise<Batch[]> {
  return listBatches({ sessionId, limit: 100 })
}

/**
 * Mark batch as submitted
 */
export async function markBatchSubmitted(
  batchId: string,
  openaiBatchId: string
): Promise<Batch | null> {
  return updateBatch(batchId, {
    openaiBatchId,
    status: 'submitted',
    openaiStatus: 'validating',
    submittedAt: new Date(),
  })
}

/**
 * Mark batch as completed
 */
export async function markBatchCompleted(
  batchId: string,
  completedRequests: number,
  failedRequests: number
): Promise<Batch | null> {
  return updateBatch(batchId, {
    status: 'completed',
    openaiStatus: 'completed',
    completedRequests,
    failedRequests,
    completedAt: new Date(),
  })
}

/**
 * Mark batch as failed
 */
export async function markBatchFailed(batchId: string, errorMessage: string): Promise<Batch | null> {
  return updateBatch(batchId, {
    status: 'failed',
    openaiStatus: 'failed',
    errorMessage,
    completedAt: new Date(),
  })
}

// ============================================================================
// BATCH REQUEST REPOSITORY METHODS
// ============================================================================

/**
 * Create a batch request
 */
export async function createBatchRequest(input: CreateBatchRequestInput): Promise<BatchRequest> {
  const db = getDatabase()

  // First get the UUID of the batch
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.batchId, input.batchId))
    .limit(1)

  if (!batch) {
    throw new Error(`Batch not found: ${input.batchId}`)
  }

  const [request] = await db
    .insert(batchRequests)
    .values({
      batchId: batch.id,
      customId: input.customId,
      requestIndex: input.requestIndex,
      fileId: input.fileId,
      relativePath: input.relativePath,
      targetLocale: input.targetLocale,
      requestBody: input.requestBody,
    })
    .returning()

  return request
}

/**
 * Bulk create batch requests
 */
export async function bulkCreateBatchRequests(inputs: CreateBatchRequestInput[]): Promise<number> {
  if (inputs.length === 0) {
    return 0
  }

  const db = getDatabase()

  // Get batch UUID
  const batchIdStr = inputs[0].batchId
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.batchId, batchIdStr))
    .limit(1)

  if (!batch) {
    throw new Error(`Batch not found: ${batchIdStr}`)
  }

  const batchUuid = batch.id

  // Process in batches
  const batchSize = 100
  let created = 0

  for (let i = 0; i < inputs.length; i += batchSize) {
    const chunk = inputs.slice(i, i + batchSize)

    const values = chunk.map((input) => ({
      batchId: batchUuid,
      customId: input.customId,
      requestIndex: input.requestIndex,
      fileId: input.fileId,
      relativePath: input.relativePath,
      targetLocale: input.targetLocale,
      requestBody: input.requestBody,
    }))

    await db.insert(batchRequests).values(values)
    created += chunk.length
  }

  log.info('Bulk created batch requests', { batchId: batchIdStr, count: created })
  return created
}

/**
 * Get batch requests by batch ID
 */
export async function getBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()

  return db
    .select({
      id: batchRequests.id,
      batchId: batchRequests.batchId,
      customId: batchRequests.customId,
      requestIndex: batchRequests.requestIndex,
      fileId: batchRequests.fileId,
      relativePath: batchRequests.relativePath,
      targetLocale: batchRequests.targetLocale,
      requestBody: batchRequests.requestBody,
      responseBody: batchRequests.responseBody,
      responseStatus: batchRequests.responseStatus,
      status: batchRequests.status,
      errorMessage: batchRequests.errorMessage,
      createdAt: batchRequests.createdAt,
      updatedAt: batchRequests.updatedAt,
    })
    .from(batchRequests)
    .innerJoin(batches, eq(batchRequests.batchId, batches.id))
    .where(eq(batches.batchId, batchId))
    .orderBy(asc(batchRequests.requestIndex))
}

/**
 * Get pending batch requests
 */
export async function getPendingBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()

  return db
    .select({
      id: batchRequests.id,
      batchId: batchRequests.batchId,
      customId: batchRequests.customId,
      requestIndex: batchRequests.requestIndex,
      fileId: batchRequests.fileId,
      relativePath: batchRequests.relativePath,
      targetLocale: batchRequests.targetLocale,
      requestBody: batchRequests.requestBody,
      responseBody: batchRequests.responseBody,
      responseStatus: batchRequests.responseStatus,
      status: batchRequests.status,
      errorMessage: batchRequests.errorMessage,
      createdAt: batchRequests.createdAt,
      updatedAt: batchRequests.updatedAt,
    })
    .from(batchRequests)
    .innerJoin(batches, eq(batchRequests.batchId, batches.id))
    .where(and(eq(batches.batchId, batchId), eq(batchRequests.status, 'pending')))
    .orderBy(asc(batchRequests.requestIndex))
}

/**
 * Update batch request with response
 */
export async function updateBatchRequestWithResponse(
  batchId: string,
  customId: string,
  responseBody: Record<string, unknown>,
  responseStatus: number,
  status: BatchRequestStatus,
  errorMessage?: string
): Promise<BatchRequest | null> {
  const db = getDatabase()

  // Get batch UUID first
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.batchId, batchId))
    .limit(1)

  if (!batch) {
    return null
  }

  const [request] = await db
    .update(batchRequests)
    .set({
      responseBody,
      responseStatus,
      status,
      errorMessage,
    })
    .where(and(eq(batchRequests.batchId, batch.id), eq(batchRequests.customId, customId)))
    .returning()

  return request || null
}

/**
 * Get batch request by custom ID
 */
export async function getBatchRequestByCustomId(
  batchId: string,
  customId: string
): Promise<BatchRequest | null> {
  const db = getDatabase()

  const [request] = await db
    .select({
      id: batchRequests.id,
      batchId: batchRequests.batchId,
      customId: batchRequests.customId,
      requestIndex: batchRequests.requestIndex,
      fileId: batchRequests.fileId,
      relativePath: batchRequests.relativePath,
      targetLocale: batchRequests.targetLocale,
      requestBody: batchRequests.requestBody,
      responseBody: batchRequests.responseBody,
      responseStatus: batchRequests.responseStatus,
      status: batchRequests.status,
      errorMessage: batchRequests.errorMessage,
      createdAt: batchRequests.createdAt,
      updatedAt: batchRequests.updatedAt,
    })
    .from(batchRequests)
    .innerJoin(batches, eq(batchRequests.batchId, batches.id))
    .where(and(eq(batches.batchId, batchId), eq(batchRequests.customId, customId)))
    .limit(1)

  return request || null
}

/**
 * Get failed batch requests
 */
export async function getFailedBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()

  return db
    .select({
      id: batchRequests.id,
      batchId: batchRequests.batchId,
      customId: batchRequests.customId,
      requestIndex: batchRequests.requestIndex,
      fileId: batchRequests.fileId,
      relativePath: batchRequests.relativePath,
      targetLocale: batchRequests.targetLocale,
      requestBody: batchRequests.requestBody,
      responseBody: batchRequests.responseBody,
      responseStatus: batchRequests.responseStatus,
      status: batchRequests.status,
      errorMessage: batchRequests.errorMessage,
      createdAt: batchRequests.createdAt,
      updatedAt: batchRequests.updatedAt,
    })
    .from(batchRequests)
    .innerJoin(batches, eq(batchRequests.batchId, batches.id))
    .where(and(eq(batches.batchId, batchId), eq(batchRequests.status, 'failed')))
    .orderBy(asc(batchRequests.requestIndex))
}

/**
 * Count batch requests by status
 */
export async function countBatchRequestsByStatus(
  batchId: string
): Promise<Record<BatchRequestStatus, number>> {
  const db = getDatabase()

  // Get batch UUID first
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.batchId, batchId))
    .limit(1)

  if (!batch) {
    return { pending: 0, completed: 0, failed: 0 }
  }

  const rows = await db
    .select({
      status: batchRequests.status,
      count: sql<number>`count(*)`,
    })
    .from(batchRequests)
    .where(eq(batchRequests.batchId, batch.id))
    .groupBy(batchRequests.status)

  const result: Record<BatchRequestStatus, number> = {
    pending: 0,
    completed: 0,
    failed: 0,
  }

  for (const row of rows) {
    result[row.status] = Number(row.count)
  }

  return result
}
