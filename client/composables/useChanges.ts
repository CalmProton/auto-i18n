import { ref, computed } from 'vue'
import type { ChangeSession } from '../types/api'
import { api } from '../lib/api-client'

export interface ChangeFilters {
  status: 'all' | 'uploaded' | 'batch-created' | 'submitted' | 'processing' | 'completed' | 'failed' | 'pr-created'
  search: string
}

export function useChanges() {
  const changes = ref<ChangeSession[]>([])
  const selectedChange = ref<ChangeSession | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = ref<ChangeFilters>({
    status: 'all',
    search: ''
  })

  // Fetch all change sessions
  const fetchChanges = async () => {
    loading.value = true
    error.value = null
    
    try {
      const params = new URLSearchParams()
      if (filters.value.status !== 'all') {
        params.append('status', filters.value.status)
      }
      
      const url = `/api/changes${params.toString() ? `?${params.toString()}` : ''}`
      const response = await api.get<{ changes: ChangeSession[] }>(url)
      
      changes.value = response.changes || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch changes'
      console.error('Error fetching changes:', err)
    } finally {
      loading.value = false
    }
  }

  // Fetch single change session
  const fetchChange = async (sessionId: string) => {
    loading.value = true
    error.value = null
    
    try {
      const response = await api.get<ChangeSession>(`/api/changes/${sessionId}`)
      selectedChange.value = response
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch change'
      console.error('Error fetching change:', err)
      return null
    } finally {
      loading.value = false
    }
  }

  // Process a change session (create batch)
  const processChange = async (sessionId: string) => {
    try {
      await api.post(`/translate/changes/${sessionId}/process`, {})
      await fetchChange(sessionId)
      await fetchChanges()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to process change'
      console.error('Error processing change:', err)
      throw err
    }
  }

  // Finalize a change session (create PR)
  const finalizeChange = async (sessionId: string) => {
    try {
      await api.post(`/translate/changes/${sessionId}/finalize`, {})
      await fetchChange(sessionId)
      await fetchChanges()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to finalize change'
      console.error('Error finalizing change:', err)
      throw err
    }
  }

  // Delete a change session
  const deleteChange = async (sessionId: string) => {
    try {
      await api.delete(`/api/changes/${sessionId}`)
      changes.value = changes.value.filter(c => c.sessionId !== sessionId)
      if (selectedChange.value?.sessionId === sessionId) {
        selectedChange.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete change'
      console.error('Error deleting change:', err)
      throw err
    }
  }

  // Get change status
  const getChangeStatus = async (sessionId: string) => {
    try {
      const response = await api.get(`/translate/changes/${sessionId}/status`)
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to get status'
      console.error('Error getting change status:', err)
      return null
    }
  }

  // Filtered changes based on search
  const filteredChanges = computed(() => {
    if (!filters.value.search) {
      return changes.value
    }
    
    const search = filters.value.search.toLowerCase()
    return changes.value.filter(change =>
      change.sessionId.toLowerCase().includes(search) ||
      change.repositoryName.toLowerCase().includes(search) ||
      change.commit.message.toLowerCase().includes(search) ||
      change.commit.author?.toLowerCase().includes(search)
    )
  })

  // Stats
  const stats = computed(() => {
    const total = changes.value.length
    const byStatus = changes.value.reduce((acc, change) => {
      acc[change.status] = (acc[change.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const byAutomation = changes.value.reduce((acc, change) => {
      acc[change.automationMode] = (acc[change.automationMode] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total,
      byStatus,
      byAutomation,
      withErrors: changes.value.filter(c => c.hasErrors).length
    }
  })

  return {
    changes,
    selectedChange,
    loading,
    error,
    filters,
    filteredChanges,
    stats,
    fetchChanges,
    fetchChange,
    processChange,
    finalizeChange,
    deleteChange,
    getChangeStatus
  }
}
