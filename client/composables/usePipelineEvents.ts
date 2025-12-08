/**
 * Pipeline Events Composable
 * Manages pipeline events, API logs, and SSE connections for real-time updates
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api-client'

// Types
export interface PipelineEvent {
  id: string
  step: string
  status: 'started' | 'in-progress' | 'completed' | 'failed' | 'cancelled' | 'retrying'
  message?: string
  durationMs?: number
  batchId?: string
  jobId?: string
  createdAt: string
  hasRequestData?: boolean
  hasResponseData?: boolean
  hasErrorData?: boolean
}

export interface PipelineEventDetail extends PipelineEvent {
  requestData?: Record<string, unknown>
  responseData?: Record<string, unknown>
  errorData?: {
    message: string
    stack?: string
    code?: string
  }
}

export interface ApiRequestLog {
  id: string
  provider: string
  endpoint: string
  method: string
  responseStatus?: number
  durationMs?: number
  filePath?: string
  sourceLocale?: string
  targetLocale?: string
  isMock: boolean
  createdAt: string
  hasError: boolean
}

export interface ApiRequestLogDetail extends ApiRequestLog {
  requestHeaders?: Record<string, string>
  requestBody?: Record<string, unknown>
  responseHeaders?: Record<string, string>
  responseBody?: Record<string, unknown>
  errorMessage?: string
  errorStack?: string
}

export interface TranslationMode {
  provider: string
  isMockMode: boolean
  globalMockEnabled: boolean
}

export interface PipelineStats {
  pipelineEvents: number
  apiRequestLogs: number
  batches: number
}

// Composable
export function usePipelineEvents(senderId?: string) {
  // State
  const events = ref<PipelineEvent[]>([])
  const logs = ref<ApiRequestLog[]>([])
  const selectedEvent = ref<PipelineEventDetail | null>(null)
  const selectedLog = ref<ApiRequestLogDetail | null>(null)
  const translationMode = ref<TranslationMode | null>(null)
  const stats = ref<PipelineStats | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sseConnected = ref(false)

  // SSE connection
  let eventSource: EventSource | null = null

  // Computed
  const latestEventByStep = computed(() => {
    const map = new Map<string, PipelineEvent>()
    // Events are in descending order (newest first)
    for (const event of events.value) {
      if (!map.has(event.step)) {
        map.set(event.step, event)
      }
    }
    return map
  })

  const stepStatuses = computed(() => {
    const steps = [
      'upload',
      'batch-create',
      'batch-submit',
      'batch-poll',
      'batch-process',
      'translate',
      'github-finalize',
      'github-pr',
    ]

    return steps.map((step) => {
      const event = latestEventByStep.value.get(step)
      return {
        step,
        status: event?.status ?? 'not-started',
        message: event?.message,
        durationMs: event?.durationMs,
        createdAt: event?.createdAt,
      }
    })
  })

  const mockModeActive = computed(() => translationMode.value?.isMockMode ?? false)

  // Methods
  const fetchTranslationMode = async () => {
    try {
      const response = await api.get<TranslationMode>('/api/pipeline/mode')
      translationMode.value = response
    } catch (err) {
      console.error('Failed to fetch translation mode:', err)
    }
  }

  const fetchEvents = async (limit = 100, offset = 0) => {
    if (!senderId) return

    loading.value = true
    error.value = null

    try {
      const response = await api.get<{
        success: boolean
        events: PipelineEvent[]
        total: number
      }>(`/api/pipeline/${senderId}/events`, { limit: String(limit), offset: String(offset) })

      if (response.success) {
        events.value = response.events
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch events'
      console.error('Error fetching pipeline events:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchEventDetail = async (eventId: string) => {
    if (!senderId) return

    try {
      const response = await api.get<{
        success: boolean
        event: PipelineEventDetail
      }>(`/api/pipeline/${senderId}/events/${eventId}`)

      if (response.success) {
        selectedEvent.value = response.event
      }
    } catch (err) {
      console.error('Error fetching event detail:', err)
    }
  }

  const fetchLogs = async (limit = 50, offset = 0) => {
    if (!senderId) return

    try {
      const response = await api.get<{
        success: boolean
        logs: ApiRequestLog[]
        total: number
      }>(`/api/pipeline/${senderId}/logs`, { limit: String(limit), offset: String(offset) })

      if (response.success) {
        logs.value = response.logs
      }
    } catch (err) {
      console.error('Error fetching API logs:', err)
    }
  }

  const fetchLogDetail = async (logId: string) => {
    if (!senderId) return

    try {
      const response = await api.get<{
        success: boolean
        log: ApiRequestLogDetail
      }>(`/api/pipeline/${senderId}/logs/${logId}`)

      if (response.success) {
        selectedLog.value = response.log
      }
    } catch (err) {
      console.error('Error fetching log detail:', err)
    }
  }

  const fetchStats = async () => {
    if (!senderId) return

    try {
      const response = await api.get<{
        success: boolean
        counts: PipelineStats
      }>(`/api/pipeline/${senderId}/stats`)

      if (response.success) {
        stats.value = response.counts
      }
    } catch (err) {
      console.error('Error fetching pipeline stats:', err)
    }
  }

  const clearLogs = async () => {
    if (!senderId) return

    try {
      await api.delete<{ success: boolean }>(`/api/pipeline/${senderId}/logs`)
      events.value = []
      logs.value = []
      stats.value = null
      await fetchStats()
    } catch (err) {
      console.error('Error clearing logs:', err)
    }
  }

  const cancelPipeline = async () => {
    if (!senderId) return

    try {
      await api.post<{ success: boolean }>(`/api/pipeline/${senderId}/cancel`)
      await fetchEvents()
    } catch (err) {
      console.error('Error cancelling pipeline:', err)
    }
  }

  const restartPipeline = async () => {
    if (!senderId) return

    try {
      await api.post<{ success: boolean }>(`/api/pipeline/${senderId}/restart`)
      await fetchEvents()
    } catch (err) {
      console.error('Error restarting pipeline:', err)
    }
  }

  // SSE Connection
  const connectSSE = () => {
    if (!senderId || eventSource) return

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
    const accessKey = localStorage.getItem('accessKey')
    const url = new URL(`${baseUrl}/api/sse/pipeline/${senderId}`)
    if (accessKey) {
      url.searchParams.set('access_key', accessKey)
    }

    eventSource = new EventSource(url.toString())

    eventSource.onopen = () => {
      sseConnected.value = true
      console.log('SSE connected')
    }

    eventSource.onerror = (err) => {
      sseConnected.value = false
      console.error('SSE error:', err)
      // Attempt reconnection after 5 seconds
      setTimeout(() => {
        disconnectSSE()
        connectSSE()
      }, 5000)
    }

    eventSource.addEventListener('connected', (e) => {
      sseConnected.value = true
      console.log('SSE connected:', e.data)
    })

    eventSource.addEventListener('pipeline-event', (e) => {
      try {
        const event = JSON.parse(e.data)
        // Add to front of events list
        events.value = [
          {
            id: `temp-${Date.now()}`,
            step: event.step,
            status: event.status,
            message: event.message,
            createdAt: event.timestamp,
            batchId: event.batchId,
            jobId: event.jobId,
          },
          ...events.value,
        ]
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    })

    eventSource.addEventListener('batch-status', (e) => {
      try {
        const event = JSON.parse(e.data)
        console.log('Batch status update:', event)
        // Could trigger a refresh of batch data here
      } catch (err) {
        console.error('Failed to parse batch status event:', err)
      }
    })

    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received, connection is alive
    })
  }

  const disconnectSSE = () => {
    if (eventSource) {
      eventSource.close()
      eventSource = null
      sseConnected.value = false
    }
  }

  // Lifecycle
  onMounted(() => {
    fetchTranslationMode()
    if (senderId) {
      fetchEvents()
      fetchLogs()
      fetchStats()
      connectSSE()
    }
  })

  onUnmounted(() => {
    disconnectSSE()
  })

  return {
    // State
    events,
    logs,
    selectedEvent,
    selectedLog,
    translationMode,
    stats,
    loading,
    error,
    sseConnected,

    // Computed
    latestEventByStep,
    stepStatuses,
    mockModeActive,

    // Methods
    fetchTranslationMode,
    fetchEvents,
    fetchEventDetail,
    fetchLogs,
    fetchLogDetail,
    fetchStats,
    clearLogs,
    cancelPipeline,
    restartPipeline,
    connectSSE,
    disconnectSSE,
  }
}
