/**
 * Pipeline Event Service
 * High-level service for logging pipeline events and broadcasting updates
 */
import { createPipelineEvent, createApiRequestLog } from '../repositories/pipelineRepository'
import { getSessionBySenderId } from '../repositories/sessionRepository'
import { publish, Channels } from '../cache'
import { createScopedLogger } from '../utils/logger'
import type { PipelineStep, PipelineEventStatus } from '../database/schema'

const log = createScopedLogger('service:pipeline')

// ============================================================================
// TYPES
// ============================================================================

export interface LogPipelineEventOptions {
  senderId: string
  step: PipelineStep
  status: PipelineEventStatus
  message?: string
  durationMs?: number
  requestData?: Record<string, unknown>
  responseData?: Record<string, unknown>
  error?: Error
  batchId?: string
  jobId?: string
}

export interface LogApiRequestOptions {
  senderId?: string
  provider: string
  endpoint: string
  method?: string
  requestHeaders?: Record<string, string>
  requestBody?: Record<string, unknown>
  responseStatus?: number
  responseHeaders?: Record<string, string>
  responseBody?: Record<string, unknown>
  error?: Error
  durationMs?: number
  filePath?: string
  sourceLocale?: string
  targetLocale?: string
  isMock?: boolean
}

export interface PipelineEventMessage {
  type: 'pipeline-event'
  senderId: string
  step: PipelineStep
  status: PipelineEventStatus
  message?: string
  timestamp: string
  batchId?: string
  jobId?: string
}

// ============================================================================
// PIPELINE EVENT LOGGING
// ============================================================================

/**
 * Log a pipeline event and broadcast it via pub/sub
 */
export async function logPipelineEvent(options: LogPipelineEventOptions): Promise<void> {
  const { senderId, step, status, message, durationMs, requestData, responseData, error, batchId, jobId } = options

  try {
    // Get session ID from senderId
    const session = await getSessionBySenderId(senderId)
    if (!session) {
      log.warn('Cannot log pipeline event: session not found', { senderId, step, status })
      return
    }

    // Create the event in the database
    await createPipelineEvent({
      sessionId: session.id,
      step,
      status,
      message,
      durationMs,
      requestData,
      responseData,
      errorData: error ? {
        message: error.message,
        stack: error.stack,
        code: (error as Error & { code?: string }).code,
      } : undefined,
      batchId,
      jobId,
    })

    // Broadcast the event via pub/sub
    const eventMessage: PipelineEventMessage = {
      type: 'pipeline-event',
      senderId,
      step,
      status,
      message,
      timestamp: new Date().toISOString(),
      batchId,
      jobId,
    }

    await publish(Channels.translationProgress, eventMessage)

    log.debug('Pipeline event logged', { senderId, step, status, message })
  } catch (err) {
    log.error('Failed to log pipeline event', { senderId, step, status, error: err })
  }
}

/**
 * Log the start of a pipeline step
 */
export async function logStepStart(
  senderId: string,
  step: PipelineStep,
  options?: { message?: string; batchId?: string; jobId?: string; requestData?: Record<string, unknown> }
): Promise<number> {
  await logPipelineEvent({
    senderId,
    step,
    status: 'started',
    message: options?.message ?? `Starting ${step}`,
    batchId: options?.batchId,
    jobId: options?.jobId,
    requestData: options?.requestData,
  })

  return Date.now()
}

/**
 * Log the successful completion of a pipeline step
 */
export async function logStepComplete(
  senderId: string,
  step: PipelineStep,
  startTime: number,
  options?: { message?: string; batchId?: string; jobId?: string; responseData?: Record<string, unknown> }
): Promise<void> {
  const durationMs = Date.now() - startTime

  await logPipelineEvent({
    senderId,
    step,
    status: 'completed',
    message: options?.message ?? `Completed ${step}`,
    durationMs,
    batchId: options?.batchId,
    jobId: options?.jobId,
    responseData: options?.responseData,
  })
}

/**
 * Log the failure of a pipeline step
 */
export async function logStepFailed(
  senderId: string,
  step: PipelineStep,
  error: Error,
  startTime?: number,
  options?: { message?: string; batchId?: string; jobId?: string }
): Promise<void> {
  const durationMs = startTime ? Date.now() - startTime : undefined

  await logPipelineEvent({
    senderId,
    step,
    status: 'failed',
    message: options?.message ?? `Failed ${step}: ${error.message}`,
    durationMs,
    error,
    batchId: options?.batchId,
    jobId: options?.jobId,
  })
}

/**
 * Log progress update for a step
 */
export async function logStepProgress(
  senderId: string,
  step: PipelineStep,
  message: string,
  options?: { batchId?: string; jobId?: string; responseData?: Record<string, unknown> }
): Promise<void> {
  await logPipelineEvent({
    senderId,
    step,
    status: 'in-progress',
    message,
    batchId: options?.batchId,
    jobId: options?.jobId,
    responseData: options?.responseData,
  })
}

// ============================================================================
// API REQUEST LOGGING
// ============================================================================

/**
 * Log an API request (to an AI provider or external service)
 */
export async function logApiRequest(options: LogApiRequestOptions): Promise<void> {
  const { senderId, provider, endpoint, method, requestHeaders, requestBody, responseStatus, responseHeaders, responseBody, error, durationMs, filePath, sourceLocale, targetLocale, isMock } = options

  try {
    // Get session ID if senderId is provided
    let sessionId: string | undefined
    if (senderId) {
      const session = await getSessionBySenderId(senderId)
      sessionId = session?.id
    }

    await createApiRequestLog({
      sessionId,
      provider,
      endpoint,
      method,
      requestHeaders,
      requestBody,
      responseStatus,
      responseHeaders,
      responseBody,
      errorMessage: error?.message,
      errorStack: error?.stack,
      durationMs,
      filePath,
      sourceLocale,
      targetLocale,
      isMock,
    })

    log.debug('API request logged', { provider, endpoint, status: responseStatus, isMock })
  } catch (err) {
    log.error('Failed to log API request', { provider, endpoint, error: err })
  }
}

/**
 * Helper to wrap an API call with logging
 */
export async function withApiLogging<T>(
  options: Omit<LogApiRequestOptions, 'responseStatus' | 'responseBody' | 'error' | 'durationMs'>,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await fn()
    const durationMs = Date.now() - startTime

    await logApiRequest({
      ...options,
      responseStatus: 200,
      responseBody: typeof result === 'object' ? result as Record<string, unknown> : { result },
      durationMs,
    })

    return result
  } catch (error) {
    const durationMs = Date.now() - startTime

    await logApiRequest({
      ...options,
      responseStatus: (error as { status?: number }).status ?? 500,
      error: error as Error,
      durationMs,
    })

    throw error
  }
}
