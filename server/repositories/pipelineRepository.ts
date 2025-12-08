/**
 * Pipeline Events Repository
 * Handles CRUD operations for pipeline events and API request logs
 */
import { eq, and, desc, lt, sql, inArray } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import { pipelineEvents, apiRequestLogs, sessions } from '../database/schema'
import type {
  PipelineEvent,
  NewPipelineEvent,
  PipelineStep,
  PipelineEventStatus,
  ApiRequestLog,
  NewApiRequestLog,
} from '../database/schema'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('repository:pipeline')

// ============================================================================
// TYPES
// ============================================================================

export type { PipelineEvent, PipelineStep, PipelineEventStatus, ApiRequestLog }

export interface CreatePipelineEventInput {
  sessionId: string
  step: PipelineStep
  status: PipelineEventStatus
  message?: string
  durationMs?: number
  requestData?: Record<string, unknown>
  responseData?: Record<string, unknown>
  errorData?: { message: string; stack?: string; code?: string }
  batchId?: string
  jobId?: string
}

export interface CreateApiRequestLogInput {
  sessionId?: string
  provider: string
  endpoint: string
  method?: string
  requestHeaders?: Record<string, string>
  requestBody?: Record<string, unknown>
  responseStatus?: number
  responseHeaders?: Record<string, string>
  responseBody?: Record<string, unknown>
  errorMessage?: string
  errorStack?: string
  durationMs?: number
  filePath?: string
  sourceLocale?: string
  targetLocale?: string
  isMock?: boolean
}

export interface PipelineEventFilter {
  sessionId?: string
  step?: PipelineStep
  status?: PipelineEventStatus
  batchId?: string
  limit?: number
  offset?: number
}

export interface ApiRequestLogFilter {
  sessionId?: string
  provider?: string
  responseStatus?: number
  limit?: number
  offset?: number
}

// ============================================================================
// PIPELINE EVENTS REPOSITORY
// ============================================================================

/**
 * Create a new pipeline event
 */
export async function createPipelineEvent(
  input: CreatePipelineEventInput
): Promise<PipelineEvent> {
  const db = getDatabase()

  const [event] = await db
    .insert(pipelineEvents)
    .values({
      sessionId: input.sessionId,
      step: input.step,
      status: input.status,
      message: input.message,
      durationMs: input.durationMs,
      requestData: input.requestData,
      responseData: input.responseData,
      errorData: input.errorData,
      batchId: input.batchId,
      jobId: input.jobId,
    })
    .returning()

  log.debug('Created pipeline event', {
    eventId: event.id,
    sessionId: input.sessionId,
    step: input.step,
    status: input.status,
  })

  return event
}

/**
 * Get pipeline events for a session
 */
export async function getPipelineEventsBySession(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<PipelineEvent[]> {
  const db = getDatabase()
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const events = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.sessionId, sessionId))
    .orderBy(desc(pipelineEvents.createdAt))
    .limit(limit)
    .offset(offset)

  return events
}

/**
 * Get pipeline events by senderId (looks up session first)
 */
export async function getPipelineEventsBySenderId(
  senderId: string,
  options?: { limit?: number; offset?: number }
): Promise<PipelineEvent[]> {
  const db = getDatabase()
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const events = await db
    .select({
      id: pipelineEvents.id,
      sessionId: pipelineEvents.sessionId,
      step: pipelineEvents.step,
      status: pipelineEvents.status,
      message: pipelineEvents.message,
      durationMs: pipelineEvents.durationMs,
      requestData: pipelineEvents.requestData,
      responseData: pipelineEvents.responseData,
      errorData: pipelineEvents.errorData,
      batchId: pipelineEvents.batchId,
      jobId: pipelineEvents.jobId,
      createdAt: pipelineEvents.createdAt,
    })
    .from(pipelineEvents)
    .innerJoin(sessions, eq(sessions.id, pipelineEvents.sessionId))
    .where(eq(sessions.senderId, senderId))
    .orderBy(desc(pipelineEvents.createdAt))
    .limit(limit)
    .offset(offset)

  return events as PipelineEvent[]
}

/**
 * Get latest event for each step in a session
 */
export async function getLatestEventsByStep(
  sessionId: string
): Promise<Map<PipelineStep, PipelineEvent>> {
  const db = getDatabase()

  const events = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.sessionId, sessionId))
    .orderBy(desc(pipelineEvents.createdAt))

  const latestByStep = new Map<PipelineStep, PipelineEvent>()
  for (const event of events) {
    if (!latestByStep.has(event.step)) {
      latestByStep.set(event.step, event)
    }
  }

  return latestByStep
}

/**
 * Delete pipeline events for a session
 */
export async function deletePipelineEventsBySession(
  sessionId: string
): Promise<number> {
  const db = getDatabase()

  const result = await db
    .delete(pipelineEvents)
    .where(eq(pipelineEvents.sessionId, sessionId))
    .returning({ id: pipelineEvents.id })

  log.info('Deleted pipeline events', {
    sessionId,
    count: result.length,
  })

  return result.length
}

/**
 * Delete old pipeline events (for cleanup)
 */
export async function deleteOldPipelineEvents(
  olderThanDays: number
): Promise<number> {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

  const result = await db
    .delete(pipelineEvents)
    .where(lt(pipelineEvents.createdAt, cutoff))
    .returning({ id: pipelineEvents.id })

  log.info('Deleted old pipeline events', {
    olderThanDays,
    count: result.length,
  })

  return result.length
}

// ============================================================================
// API REQUEST LOGS REPOSITORY
// ============================================================================

/**
 * Create a new API request log
 */
export async function createApiRequestLog(
  input: CreateApiRequestLogInput
): Promise<ApiRequestLog> {
  const db = getDatabase()

  const [logEntry] = await db
    .insert(apiRequestLogs)
    .values({
      sessionId: input.sessionId,
      provider: input.provider,
      endpoint: input.endpoint,
      method: input.method ?? 'POST',
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      responseStatus: input.responseStatus,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      errorMessage: input.errorMessage,
      errorStack: input.errorStack,
      durationMs: input.durationMs,
      filePath: input.filePath,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      isMock: input.isMock ? 'true' : 'false',
    })
    .returning()

  log.debug('Created API request log', {
    logId: logEntry.id,
    provider: input.provider,
    endpoint: input.endpoint,
    status: input.responseStatus,
  })

  return logEntry
}

/**
 * Get API request logs for a session
 */
export async function getApiRequestLogsBySession(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<ApiRequestLog[]> {
  const db = getDatabase()
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const logs = await db
    .select()
    .from(apiRequestLogs)
    .where(eq(apiRequestLogs.sessionId, sessionId))
    .orderBy(desc(apiRequestLogs.createdAt))
    .limit(limit)
    .offset(offset)

  return logs
}

/**
 * Get API request logs by senderId
 */
export async function getApiRequestLogsBySenderId(
  senderId: string,
  options?: { limit?: number; offset?: number }
): Promise<ApiRequestLog[]> {
  const db = getDatabase()
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const logs = await db
    .select({
      id: apiRequestLogs.id,
      sessionId: apiRequestLogs.sessionId,
      provider: apiRequestLogs.provider,
      endpoint: apiRequestLogs.endpoint,
      method: apiRequestLogs.method,
      requestHeaders: apiRequestLogs.requestHeaders,
      requestBody: apiRequestLogs.requestBody,
      responseStatus: apiRequestLogs.responseStatus,
      responseHeaders: apiRequestLogs.responseHeaders,
      responseBody: apiRequestLogs.responseBody,
      errorMessage: apiRequestLogs.errorMessage,
      errorStack: apiRequestLogs.errorStack,
      durationMs: apiRequestLogs.durationMs,
      createdAt: apiRequestLogs.createdAt,
      filePath: apiRequestLogs.filePath,
      sourceLocale: apiRequestLogs.sourceLocale,
      targetLocale: apiRequestLogs.targetLocale,
      isMock: apiRequestLogs.isMock,
    })
    .from(apiRequestLogs)
    .innerJoin(sessions, eq(sessions.id, apiRequestLogs.sessionId))
    .where(eq(sessions.senderId, senderId))
    .orderBy(desc(apiRequestLogs.createdAt))
    .limit(limit)
    .offset(offset)

  return logs as ApiRequestLog[]
}

/**
 * Delete API request logs for a session
 */
export async function deleteApiRequestLogsBySession(
  sessionId: string
): Promise<number> {
  const db = getDatabase()

  const result = await db
    .delete(apiRequestLogs)
    .where(eq(apiRequestLogs.sessionId, sessionId))
    .returning({ id: apiRequestLogs.id })

  log.info('Deleted API request logs', {
    sessionId,
    count: result.length,
  })

  return result.length
}

/**
 * Delete old API request logs (for cleanup)
 */
export async function deleteOldApiRequestLogs(
  olderThanDays: number
): Promise<number> {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

  const result = await db
    .delete(apiRequestLogs)
    .where(lt(apiRequestLogs.createdAt, cutoff))
    .returning({ id: apiRequestLogs.id })

  log.info('Deleted old API request logs', {
    olderThanDays,
    count: result.length,
  })

  return result.length
}

/**
 * Get counts for pipeline events and API logs
 */
export async function getPipelineLogCounts(sessionId: string): Promise<{
  pipelineEvents: number
  apiRequestLogs: number
}> {
  const db = getDatabase()

  const [eventCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pipelineEvents)
    .where(eq(pipelineEvents.sessionId, sessionId))

  const [logCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apiRequestLogs)
    .where(eq(apiRequestLogs.sessionId, sessionId))

  return {
    pipelineEvents: Number(eventCount?.count ?? 0),
    apiRequestLogs: Number(logCount?.count ?? 0),
  }
}

/**
 * Clear all logs for a session (pipeline events + API logs)
 */
export async function clearSessionLogs(sessionId: string): Promise<{
  pipelineEventsDeleted: number
  apiLogsDeleted: number
}> {
  const pipelineEventsDeleted = await deletePipelineEventsBySession(sessionId)
  const apiLogsDeleted = await deleteApiRequestLogsBySession(sessionId)

  return {
    pipelineEventsDeleted,
    apiLogsDeleted,
  }
}
