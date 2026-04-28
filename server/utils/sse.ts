/**
 * In-process SSE pub/sub.
 *
 * Stored on globalThis to survive Nitro HMR. Each senderId maps to a Set of
 * active EventStream senders. When a pipeline step completes, it calls
 * publish() to push the event to all connected dashboard clients.
 */
import type { EventStream } from 'h3'

export interface SseEvent {
  type: string
  data: unknown
}

const GLOBAL_KEY = '__autoI18nSSE__'
const g = globalThis as any
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = new Map<string, Set<EventStream>>()
}
const streams: Map<string, Set<EventStream>> = g[GLOBAL_KEY]

/** Register a new SSE stream for a senderId */
export function addStream(senderId: string, stream: EventStream): void {
  if (!streams.has(senderId)) streams.set(senderId, new Set())
  streams.get(senderId)!.add(stream)
}

/** Remove a stream when the client disconnects */
export function removeStream(senderId: string, stream: EventStream): void {
  streams.get(senderId)?.delete(stream)
  if (streams.get(senderId)?.size === 0) streams.delete(senderId)
}

/** Publish an event to all clients watching a senderId */
export function publish(senderId: string, event: SseEvent): void {
  const clients = streams.get(senderId)
  if (!clients || clients.size === 0) return
  const payload = JSON.stringify(event)
  for (const stream of clients) {
    stream.push({ data: payload }).catch(() => {
      // client disconnected — will be cleaned up on close
    })
  }
}

/** Publish an event to ALL connected clients (e.g. system-wide alerts) */
export function publishGlobal(event: SseEvent): void {
  for (const [senderId] of streams) {
    publish(senderId, event)
  }
}
