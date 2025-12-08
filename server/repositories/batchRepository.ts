/**
 * Batch Repository
 * Handles CRUD operations for OpenAI batch translation jobs
 * Replaces file-based storage in tmp/<senderId>/batches/
 */
import { getDatabase } from '../database/connection'
import { cacheGet, cacheSet, cacheDel } from '../database/redis'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:batch')

// Cache TTL in seconds
const BATCH_CACHE_TTL = 60 // 1 minute (batches change frequently)

// ============================================================================
// TYPES
// ============================================================================

export type BatchStatus = 'created' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type OpenAIBatchStatus = 'validating' | 'failed' | 'in_progress' | 'finalizing' | 'completed' | 'expired' | 'cancelling' | 'cancelled'

export interface BatchManifest {
  batchId: string
  senderId: string
  sourceLocale: string
  targetLocales: string[]
  contentTypes: string[]
  model: string
  totalRequests: number
  files: Array<{
    relativePath: string
    contentType: string
    targetLocales: string[]
  }>
  createdAt: string
}

export interface Batch {
  id: string
  batchId: string
  sessionId: string
  
  // Batch configuration
  sourceLocale: string
  targetLocales: string[]
  contentTypes: string[]
  model: string
  
  // OpenAI Batch API details
  openaiBatchId?: string
  openaiStatus?: OpenAIBatchStatus
  
  // Progress tracking
  totalRequests: number
  completedRequests: number
  failedRequests: number
  
  // Status
  status: BatchStatus
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
  submittedAt?: Date
  completedAt?: Date
  
  // Error tracking
  errorMessage?: string
  
  // Manifest data
  manifest: BatchManifest
}

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

export type BatchRequestStatus = 'pending' | 'completed' | 'failed'

export interface BatchRequest {
  id: string
  batchId: string
  customId: string
  requestIndex: number
  fileId?: string
  relativePath: string
  targetLocale: string
  requestBody: Record<string, unknown>
  responseBody?: Record<string, unknown>
  responseStatus?: number
  status: BatchRequestStatus
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateBatchRequestInput {
  batchId: string
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
// MAPPER
// ============================================================================

function mapRowToBatch(row: Record<string, unknown>): Batch {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    sessionId: row.session_id as string,
    sourceLocale: row.source_locale as string,
    targetLocales: (row.target_locales as string[]) || [],
    contentTypes: (row.content_types as string[]) || [],
    model: row.model as string,
    openaiBatchId: row.openai_batch_id as string | undefined,
    openaiStatus: row.openai_status as OpenAIBatchStatus | undefined,
    totalRequests: row.total_requests as number,
    completedRequests: row.completed_requests as number,
    failedRequests: row.failed_requests as number,
    status: row.status as BatchStatus,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    submittedAt: row.submitted_at ? new Date(row.submitted_at as string) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    errorMessage: row.error_message as string | undefined,
    manifest: row.manifest as BatchManifest,
  }
}

function mapRowToBatchRequest(row: Record<string, unknown>): BatchRequest {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    customId: row.custom_id as string,
    requestIndex: row.request_index as number,
    fileId: row.file_id as string | undefined,
    relativePath: row.relative_path as string,
    targetLocale: row.target_locale as string,
    requestBody: row.request_body as Record<string, unknown>,
    responseBody: row.response_body as Record<string, unknown> | undefined,
    responseStatus: row.response_status as number | undefined,
    status: row.status as BatchRequestStatus,
    errorMessage: row.error_message as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// ============================================================================
// BATCH REPOSITORY METHODS
// ============================================================================

/**
 * Create a new batch
 */
export async function createBatch(input: CreateBatchInput): Promise<Batch> {
  const db = getDatabase()
  
  const rows = await db`
    INSERT INTO batches (
      batch_id,
      session_id,
      source_locale,
      target_locales,
      content_types,
      model,
      total_requests,
      manifest
    ) VALUES (
      ${input.batchId},
      ${input.sessionId},
      ${input.sourceLocale},
      ${input.targetLocales},
      ${input.contentTypes},
      ${input.model},
      ${input.totalRequests},
      ${JSON.stringify(input.manifest)}
    )
    RETURNING *
  `
  
  const batch = mapRowToBatch(rows[0])
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
  const rows = await db`
    SELECT * FROM batches WHERE batch_id = ${batchId}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const batch = mapRowToBatch(rows[0])
  
  // Cache the result
  await cacheSet(batchCacheKey(batchId), batch, BATCH_CACHE_TTL)
  
  return batch
}

/**
 * Get a batch by ID
 */
export async function getBatchById(id: string): Promise<Batch | null> {
  const db = getDatabase()
  const rows = await db`
    SELECT * FROM batches WHERE id = ${id}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToBatch(rows[0])
}

/**
 * Update a batch
 */
export async function updateBatch(batchId: string, input: UpdateBatchInput): Promise<Batch | null> {
  const db = getDatabase()
  
  const rows = await db`
    UPDATE batches 
    SET 
      openai_batch_id = COALESCE(${input.openaiBatchId || null}, openai_batch_id),
      openai_status = COALESCE(${input.openaiStatus || null}, openai_status),
      completed_requests = COALESCE(${input.completedRequests ?? null}, completed_requests),
      failed_requests = COALESCE(${input.failedRequests ?? null}, failed_requests),
      status = COALESCE(${input.status || null}, status),
      submitted_at = COALESCE(${input.submittedAt || null}, submitted_at),
      completed_at = COALESCE(${input.completedAt || null}, completed_at),
      error_message = COALESCE(${input.errorMessage || null}, error_message),
      manifest = COALESCE(${input.manifest ? JSON.stringify(input.manifest) : null}::jsonb, manifest)
    WHERE batch_id = ${batchId}
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  const batch = mapRowToBatch(rows[0])
  
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
  
  const result = await db`
    DELETE FROM batches WHERE batch_id = ${batchId}
    RETURNING id
  `
  
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
  
  let rows: Record<string, unknown>[]
  
  if (filter.sessionId && filter.status) {
    rows = await db`
      SELECT * FROM batches 
      WHERE session_id = ${filter.sessionId}
      AND status = ${filter.status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.sessionId) {
    rows = await db`
      SELECT * FROM batches 
      WHERE session_id = ${filter.sessionId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.status) {
    rows = await db`
      SELECT * FROM batches 
      WHERE status = ${filter.status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else if (filter.openaiStatus) {
    rows = await db`
      SELECT * FROM batches 
      WHERE openai_status = ${filter.openaiStatus}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await db`
      SELECT * FROM batches 
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  
  return rows.map(mapRowToBatch)
}

/**
 * Count batches with optional filtering
 */
export async function countBatches(filter: BatchFilter = {}): Promise<number> {
  const db = getDatabase()
  
  let result: { count: string }[]
  
  if (filter.sessionId && filter.status) {
    result = await db`
      SELECT COUNT(*) as count FROM batches 
      WHERE session_id = ${filter.sessionId}
      AND status = ${filter.status}
    `
  } else if (filter.sessionId) {
    result = await db`
      SELECT COUNT(*) as count FROM batches 
      WHERE session_id = ${filter.sessionId}
    `
  } else if (filter.status) {
    result = await db`
      SELECT COUNT(*) as count FROM batches 
      WHERE status = ${filter.status}
    `
  } else {
    result = await db`SELECT COUNT(*) as count FROM batches`
  }
  
  return parseInt(result[0].count, 10)
}

/**
 * Get pending batches (for polling)
 */
export async function getPendingBatches(): Promise<Batch[]> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT * FROM batches 
    WHERE status IN ('submitted', 'processing')
    AND openai_status NOT IN ('completed', 'failed', 'expired', 'cancelled')
    ORDER BY submitted_at ASC
  `
  
  return rows.map(mapRowToBatch)
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
export async function markBatchSubmitted(batchId: string, openaiBatchId: string): Promise<Batch | null> {
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
  const batchRows = await db`
    SELECT id FROM batches WHERE batch_id = ${input.batchId}
  `
  
  if (batchRows.length === 0) {
    throw new Error(`Batch not found: ${input.batchId}`)
  }
  
  const batchUuid = batchRows[0].id as string
  
  const rows = await db`
    INSERT INTO batch_requests (
      batch_id,
      custom_id,
      request_index,
      file_id,
      relative_path,
      target_locale,
      request_body
    ) VALUES (
      ${batchUuid},
      ${input.customId},
      ${input.requestIndex},
      ${input.fileId || null},
      ${input.relativePath},
      ${input.targetLocale},
      ${JSON.stringify(input.requestBody)}
    )
    RETURNING *
  `
  
  return mapRowToBatchRequest(rows[0])
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
  const batchId = inputs[0].batchId
  const batchRows = await db`
    SELECT id FROM batches WHERE batch_id = ${batchId}
  `
  
  if (batchRows.length === 0) {
    throw new Error(`Batch not found: ${batchId}`)
  }
  
  const batchUuid = batchRows[0].id as string
  
  // Process in batches
  const batchSize = 100
  let created = 0
  
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize)
    
    for (const input of batch) {
      await db`
        INSERT INTO batch_requests (
          batch_id,
          custom_id,
          request_index,
          file_id,
          relative_path,
          target_locale,
          request_body
        ) VALUES (
          ${batchUuid},
          ${input.customId},
          ${input.requestIndex},
          ${input.fileId || null},
          ${input.relativePath},
          ${input.targetLocale},
          ${JSON.stringify(input.requestBody)}
        )
      `
      created++
    }
  }
  
  log.info('Bulk created batch requests', { batchId, count: created })
  return created
}

/**
 * Get batch requests by batch ID
 */
export async function getBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT br.* FROM batch_requests br
    JOIN batches b ON br.batch_id = b.id
    WHERE b.batch_id = ${batchId}
    ORDER BY br.request_index ASC
  `
  
  return rows.map(mapRowToBatchRequest)
}

/**
 * Get pending batch requests
 */
export async function getPendingBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT br.* FROM batch_requests br
    JOIN batches b ON br.batch_id = b.id
    WHERE b.batch_id = ${batchId}
    AND br.status = 'pending'
    ORDER BY br.request_index ASC
  `
  
  return rows.map(mapRowToBatchRequest)
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
  
  const rows = await db`
    UPDATE batch_requests 
    SET 
      response_body = ${JSON.stringify(responseBody)},
      response_status = ${responseStatus},
      status = ${status},
      error_message = ${errorMessage || null}
    WHERE custom_id = ${customId}
    AND batch_id IN (SELECT id FROM batches WHERE batch_id = ${batchId})
    RETURNING *
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToBatchRequest(rows[0])
}

/**
 * Get batch request by custom ID
 */
export async function getBatchRequestByCustomId(batchId: string, customId: string): Promise<BatchRequest | null> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT br.* FROM batch_requests br
    JOIN batches b ON br.batch_id = b.id
    WHERE b.batch_id = ${batchId}
    AND br.custom_id = ${customId}
  `
  
  if (rows.length === 0) {
    return null
  }
  
  return mapRowToBatchRequest(rows[0])
}

/**
 * Get failed batch requests
 */
export async function getFailedBatchRequests(batchId: string): Promise<BatchRequest[]> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT br.* FROM batch_requests br
    JOIN batches b ON br.batch_id = b.id
    WHERE b.batch_id = ${batchId}
    AND br.status = 'failed'
    ORDER BY br.request_index ASC
  `
  
  return rows.map(mapRowToBatchRequest)
}

/**
 * Count batch requests by status
 */
export async function countBatchRequestsByStatus(batchId: string): Promise<Record<BatchRequestStatus, number>> {
  const db = getDatabase()
  
  const rows = await db`
    SELECT br.status, COUNT(*) as count 
    FROM batch_requests br
    JOIN batches b ON br.batch_id = b.id
    WHERE b.batch_id = ${batchId}
    GROUP BY br.status
  ` as { status: BatchRequestStatus; count: string }[]
  
  const result: Record<BatchRequestStatus, number> = {
    pending: 0,
    completed: 0,
    failed: 0,
  }
  
  for (const row of rows) {
    result[row.status] = parseInt(row.count, 10)
  }
  
  return result
}
