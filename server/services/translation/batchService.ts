import { db, schema } from '../../db'
import { eq, and } from 'drizzle-orm'
import { getSetting } from '../../utils/getSetting'
import {
  createOpenAIBatchJsonl,
  submitOpenAIBatch,
  processOpenAIBatchOutput,
} from './providers/openai-batch'
import {
  submitAnthropicBatch,
  processAnthropicBatchOutput,
} from './providers/anthropic-batch'
import { getBatchProviderName } from './index'
import type { BatchRequest } from './types'

const { files, batches, batchRequests } = schema

/**
 * Create a batch record from a session's uploaded files.
 * Returns the new batch DB id.
 */
export async function createBatchFromSession(sessionId: string): Promise<string> {
  const provider = await getBatchProviderName()
  if (!provider) throw new Error('No batch provider configured (need OPENAI_API_KEY or ANTHROPIC_API_KEY)')

  // Load the session to get target locales
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const targetLocales: string[] = JSON.parse(session.targetLocales)

  // Load all uploaded files for this session
  const uploadedFiles = await db.select().from(files)
    .where(and(eq(files.sessionId, sessionId), eq(files.fileType, 'upload')))

  if (uploadedFiles.length === 0) {
    throw new Error('No uploaded files found for session')
  }

  // Build BatchRequest items — one per file per target locale
  const batchReqItems: BatchRequest[] = []
  for (const file of uploadedFiles) {
    for (const targetLocale of targetLocales) {
      if (targetLocale === session.sourceLocale) continue
      batchReqItems.push({
        customId: `${file.id}::${targetLocale}`,
        content: file.content,
        contentType: file.format as 'markdown' | 'json',
        sourceLocale: session.sourceLocale,
        targetLocale,
        filePath: file.filePath,
      })
    }
  }

  // Build manifest
  const manifest = JSON.stringify({
    provider,
    sessionId,
    totalRequests: batchReqItems.length,
    files: uploadedFiles.map(f => ({ id: f.id, filePath: f.filePath, contentType: f.contentType })),
    targetLocales,
  })

  // Create batch row
  const [batch] = await db.insert(batches).values({
    sessionId,
    provider,
    status: 'pending',
    manifest,
    totalRequests: batchReqItems.length,
    completed: 0,
    failed: 0,
  }).returning()

  // Create batch_request rows
  for (const item of batchReqItems) {
    const requestBody = JSON.stringify({
      customId: item.customId,
      content: item.content,
      contentType: item.contentType,
    })
    await db.insert(batchRequests).values({
      batchId: batch!.id,
      sessionId,
      customId: item.customId,
      requestBody,
      status: 'pending',
    })
  }

  return batch!.id
}

/**
 * Submit a batch to the configured provider.
 * Updates the batch row with the external batch ID and status.
 */
export async function submitBatch(batchDbId: string): Promise<string> {
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchDbId))
  if (!batch) throw new Error(`Batch ${batchDbId} not found`)

  // Load all request items
  const reqRows = await db.select().from(batchRequests).where(eq(batchRequests.batchId, batchDbId))

  // Rebuild BatchRequest items from stored data
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, batch.sessionId))
  if (!session) throw new Error(`Session ${batch.sessionId} not found`)

  const uploadedFiles = await db.select().from(files)
    .where(and(eq(files.sessionId, batch.sessionId), eq(files.fileType, 'upload')))
  const fileById = new Map(uploadedFiles.map(f => [f.id, f]))

  const batchItems: BatchRequest[] = []
  for (const req of reqRows) {
    const [fileId, targetLocale] = req.customId.split('::')
    const file = fileById.get(fileId!)
    if (!file || !targetLocale) continue
    batchItems.push({
      customId: req.customId,
      content: file.content,
      contentType: file.format as 'markdown' | 'json',
      sourceLocale: session.sourceLocale,
      targetLocale,
      filePath: file.filePath,
    })
  }

  let externalId: string
  if (batch.provider === 'openai') {
    const jsonl = await createOpenAIBatchJsonl(batchItems)
    externalId = await submitOpenAIBatch(jsonl)
  } else if (batch.provider === 'anthropic') {
    externalId = await submitAnthropicBatch(batchItems)
  } else {
    throw new Error(`Unknown batch provider: ${batch.provider}`)
  }

  await db.update(batches).set({
    externalBatchId: externalId,
    status: 'submitted',
    updatedAt: new Date().toISOString(),
  }).where(eq(batches.id, batchDbId))

  return externalId
}

/**
 * Process completed batch output — save translations to the files table.
 */
export async function processBatchOutput(batchDbId: string): Promise<void> {
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchDbId))
  if (!batch?.externalBatchId) throw new Error(`Batch ${batchDbId} has no external ID`)

  let results
  if (batch.provider === 'openai') {
    results = await processOpenAIBatchOutput(batch.externalBatchId)
  } else if (batch.provider === 'anthropic') {
    results = await processAnthropicBatchOutput(batch.externalBatchId)
  } else {
    throw new Error(`Unknown provider: ${batch.provider}`)
  }

  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, batch.sessionId))
  if (!session) throw new Error(`Session ${batch.sessionId} not found`)

  const uploadedFiles = await db.select().from(files)
    .where(and(eq(files.sessionId, batch.sessionId), eq(files.fileType, 'upload')))
  const fileById = new Map(uploadedFiles.map(f => [f.id, f]))

  let completed = 0
  let failed = 0

  for (const result of results) {
    const [fileId, targetLocale] = result.customId.split('::')
    const sourceFile = fileById.get(fileId!)

    // Update batch_request row
    await db.update(batchRequests).set({
      responseBody: JSON.stringify(result),
      status: result.error ? 'failed' : 'completed',
    }).where(and(
      eq(batchRequests.batchId, batchDbId),
      eq(batchRequests.customId, result.customId),
    ))

    if (result.error || !sourceFile || !targetLocale || !result.content) {
      failed++
      continue
    }

    // Save translated file
    await db.insert(files).values({
      sessionId: batch.sessionId,
      fileType: 'translation',
      contentType: sourceFile.contentType,
      format: sourceFile.format,
      locale: targetLocale,
      filePath: sourceFile.filePath,
      content: result.content,
    }).onConflictDoUpdate({
      target: [files.sessionId, files.fileType, files.locale, files.filePath],
      set: { content: result.content, createdAt: new Date().toISOString() },
    })

    completed++
  }

  await db.update(batches).set({
    status: failed > 0 && completed === 0 ? 'failed' : 'completed',
    completed,
    failed,
    updatedAt: new Date().toISOString(),
  }).where(eq(batches.id, batchDbId))
}
