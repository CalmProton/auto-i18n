import { ref, computed } from 'vue'
import type { Upload, PipelineStatus, SessionType } from '../types/api'
import { api } from '../lib/api-client'

export interface PipelineFilters {
  status: 'all' | PipelineStatus
  sessionType: 'all' | SessionType
  search: string
}

export function usePipeline() {
  const uploads = ref<Upload[]>([])
  const selectedUpload = ref<Upload | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = ref<PipelineFilters>({
    status: 'all',
    sessionType: 'all',
    search: ''
  })

  // Fetch all uploads (includes both full uploads and change sessions)
  const fetchUploads = async () => {
    loading.value = true
    error.value = null
    
    try {
      const params = new URLSearchParams()
      if (filters.value.status !== 'all') {
        params.append('status', filters.value.status)
      }
      
      const url = `/api/uploads${params.toString() ? `?${params.toString()}` : ''}`
      const response = await api.get<{ uploads: Upload[] }>(url)
      
      uploads.value = response.uploads || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch uploads'
      console.error('Error fetching uploads:', err)
    } finally {
      loading.value = false
    }
  }

  // Fetch single upload session
  const fetchUpload = async (senderId: string) => {
    loading.value = true
    error.value = null
    
    try {
      const response = await api.get<any>(`/api/uploads/${senderId}`)
      selectedUpload.value = response.upload || response
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch upload'
      console.error('Error fetching upload:', err)
      return null
    } finally {
      loading.value = false
    }
  }

  // Process a session (create batch) - works for both session types
  const processSession = async (senderId: string) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        await api.post(`/translate/changes/${senderId}/process`, {})
      } else {
        await api.post(`/translate/batch`, { senderId })
      }
      await fetchUpload(senderId)
      await fetchUploads()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to process session'
      console.error('Error processing session:', err)
      throw err
    }
  }

  // Finalize a session (create PR) - works for both session types
  const finalizeSession = async (senderId: string) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        await api.post(`/translate/changes/${senderId}/finalize`, {})
      } else {
        await api.post(`/github/finalize`, { senderId })
      }
      await fetchUpload(senderId)
      await fetchUploads()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to finalize session'
      console.error('Error finalizing session:', err)
      throw err
    }
  }

  // Delete a session
  const deleteSession = async (senderId: string) => {
    try {
      await api.delete(`/api/uploads/${senderId}`)
      uploads.value = uploads.value.filter(u => u.senderId !== senderId)
      if (selectedUpload.value?.senderId === senderId) {
        selectedUpload.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete session'
      console.error('Error deleting session:', err)
      throw err
    }
  }

  // Retry batch output processing
  const retryBatchOutput = async (senderId: string) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        await api.post(`/translate/changes/${senderId}/retry-batch-output`, {})
      } else {
        const batchId = upload?.batchIds?.[0]
        if (batchId) {
          await api.post(`/translate/batch/${batchId}/process`, {})
        }
      }
      await fetchUpload(senderId)
      await fetchUploads()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to retry batch output'
      console.error('Error retrying batch output:', err)
      throw err
    }
  }

  // Retry PR creation
  const retryPR = async (senderId: string) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        await api.post(`/translate/changes/${senderId}/retry-pr`, {})
      } else {
        await api.post(`/github/finalize`, { senderId })
      }
      await fetchUpload(senderId)
      await fetchUploads()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to retry PR creation'
      console.error('Error retrying PR:', err)
      throw err
    }
  }

  // Reset session
  // full=false: Only reset PR step (keep translations)
  // full=true: Reset all steps (delete translations, start from scratch)
  const resetSession = async (senderId: string, full = false) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        const queryParam = full ? '?full=true' : ''
        await api.post(`/translate/changes/${senderId}/reset${queryParam}`, {})
      }
      await fetchUpload(senderId)
      await fetchUploads()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reset session'
      console.error('Error resetting session:', err)
      throw err
    }
  }

  // Get session status
  const getSessionStatus = async (senderId: string) => {
    try {
      const upload = uploads.value.find(u => u.senderId === senderId)
      if (upload?.sessionType === 'change-session') {
        return await api.get(`/translate/changes/${senderId}/status`)
      }
      return await fetchUpload(senderId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to get status'
      console.error('Error getting session status:', err)
      return null
    }
  }

  // Filtered uploads based on search and filters
  const filteredUploads = computed(() => {
    let filtered = uploads.value

    // Filter by session type
    if (filters.value.sessionType !== 'all') {
      filtered = filtered.filter(u => u.sessionType === filters.value.sessionType)
    }

    // Filter by search
    if (filters.value.search) {
      const search = filters.value.search.toLowerCase()
      filtered = filtered.filter(upload => {
        const matchesSenderId = upload.senderId.toLowerCase().includes(search)
        const matchesRepo = upload.repository
          ? `${upload.repository.owner}/${upload.repository.name}`.toLowerCase().includes(search)
          : false
        const matchesCommit = upload.commit
          ? upload.commit.message.toLowerCase().includes(search) ||
            upload.commit.author?.toLowerCase().includes(search)
          : false
        
        return matchesSenderId || matchesRepo || matchesCommit
      })
    }

    return filtered
  })

  // Stats
  const stats = computed(() => {
    const total = uploads.value.length
    const byStatus = uploads.value.reduce((acc, upload) => {
      const status = upload.pipelineStatus || upload.status
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const bySessionType = uploads.value.reduce((acc, upload) => {
      acc[upload.sessionType] = (acc[upload.sessionType] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const byAutomation = uploads.value.reduce((acc, upload) => {
      if (upload.automationMode) {
        acc[upload.automationMode] = (acc[upload.automationMode] || 0) + 1
      }
      return acc
    }, {} as Record<string, number>)

    return {
      total,
      byStatus,
      bySessionType,
      byAutomation,
      withErrors: uploads.value.filter(u => u.hasErrors).length
    }
  })

  return {
    uploads,
    selectedUpload,
    loading,
    error,
    filters,
    filteredUploads,
    stats,
    fetchUploads,
    fetchUpload,
    processSession,
    finalizeSession,
    deleteSession,
    retryBatchOutput,
    retryPR,
    resetSession,
    getSessionStatus
  }
}
