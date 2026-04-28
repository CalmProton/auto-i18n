import { db, schema } from '../db'
import { eq, desc } from 'drizzle-orm'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

export type PipelineEvent = InferSelectModel<typeof schema.pipelineEvents>
export type NewPipelineEvent = InferInsertModel<typeof schema.pipelineEvents>

export async function createEvent(data: NewPipelineEvent): Promise<PipelineEvent> {
  const [row] = await db.insert(schema.pipelineEvents).values(data).returning()
  return row!
}

/** Convenience wrapper: record the start of a step. Returns start timestamp for duration calc. */
export function eventStart(
  sessionId: string,
  step: string,
  request?: unknown,
): Promise<PipelineEvent> {
  return createEvent({
    sessionId,
    step,
    status: 'started',
    request: request ? JSON.stringify(request) : undefined,
  })
}

/** Record successful completion of a step. */
export function eventComplete(
  sessionId: string,
  step: string,
  durationMs: number,
  response?: unknown,
): Promise<PipelineEvent> {
  return createEvent({
    sessionId,
    step,
    status: 'completed',
    durationMs,
    response: response ? JSON.stringify(response) : undefined,
  })
}

/** Record a failed step. */
export function eventFail(
  sessionId: string,
  step: string,
  durationMs: number,
  error: string,
): Promise<PipelineEvent> {
  return createEvent({ sessionId, step, status: 'failed', durationMs, error })
}

export async function getEventsBySession(sessionId: string): Promise<PipelineEvent[]> {
  return db
    .select()
    .from(schema.pipelineEvents)
    .where(eq(schema.pipelineEvents.sessionId, sessionId))
    .orderBy(desc(schema.pipelineEvents.createdAt))
}
