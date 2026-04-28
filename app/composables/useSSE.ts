/**
 * Composable for subscribing to SSE events for a given senderId.
 * Automatically reconnects on disconnect.
 */
export function useSSE(
  senderId: Ref<string | null> | ComputedRef<string | null>,
  onUpdate: (event: { type: string; data: unknown }) => void,
) {
  let es: EventSource | null = null
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let active = false

  function connect() {
    const sid = senderId.value
    if (!sid || !import.meta.client) return

    active = true
    cleanup()

    es = new EventSource(`/api/sse/${encodeURIComponent(sid)}`)

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data)
        onUpdate(parsed)
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      cleanup()
      if (active) {
        // Reconnect after 5 seconds
        retryTimeout = setTimeout(() => connect(), 5_000)
      }
    }
  }

  function cleanup() {
    if (es) {
      es.close()
      es = null
    }
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeout = null
    }
  }

  function disconnect() {
    active = false
    cleanup()
  }

  return { connect, disconnect }
}
