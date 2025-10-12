/**
 * useUploads Composable
 * Manages upload sessions state and operations
 */

import { ref, computed } from 'vue'
import { api } from '../lib/api-client'
import type {
  Upload,
  UploadsResponse,
  UploadDetailResponse,
  TriggerTranslationRequest,
  UploadStatus,
} from '../types/api'
import { useToast } from './useToast'

const uploads = ref<Upload[]>([])
const currentUpload = ref<UploadDetailResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const pagination = ref({
  total: 0,
  limit: 50,
  offset: 0,
  hasMore: false,
})

export function useUploads() {
  const toast = useToast()

  /**
   * Fetch all uploads with optional filtering
   */
  async function fetchUploads(options?: {
    status?: UploadStatus | 'all'
    limit?: number
    offset?: number
  }): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const params: Record<string, any> = {
        limit: options?.limit || pagination.value.limit,
        offset: options?.offset || 0,
      }

      if (options?.status && options.status !== 'all') {
        params.status = options.status
      }

      const response = await api.get<UploadsResponse>('/api/uploads', params)
      uploads.value = response.uploads
      pagination.value = response.pagination
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch uploads'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch uploads:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch detailed information about a specific upload
   */
  async function fetchUploadDetail(senderId: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<UploadDetailResponse>(`/api/uploads/${senderId}`)
      currentUpload.value = response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch upload details'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch upload detail:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Trigger translation for an upload
   */
  async function triggerTranslation(
    senderId: string,
    request: TriggerTranslationRequest
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      await api.post(`/api/uploads/${senderId}/trigger`, request)
      toast.success('Translation Triggered', 'Translation job has been started')
      
      // Refresh the upload to get updated status
      await fetchUploadDetail(senderId)
      await fetchUploads()
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger translation'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to trigger translation:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete an upload session
   */
  async function deleteUpload(senderId: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      await api.delete(`/api/uploads/${senderId}`)
      toast.success('Upload Deleted', 'Upload session has been deleted')
      
      // Remove from local list
      uploads.value = uploads.value.filter((u) => u.senderId !== senderId)
      
      // Clear current upload if it was the deleted one
      if (currentUpload.value?.upload.senderId === senderId) {
        currentUpload.value = null
      }
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete upload'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to delete upload:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Refresh the uploads list
   */
  async function refresh(): Promise<void> {
    await fetchUploads({ offset: pagination.value.offset })
  }

  /**
   * Load next page of uploads
   */
  async function loadMore(): Promise<void> {
    if (!pagination.value.hasMore) return
    await fetchUploads({ offset: pagination.value.offset + pagination.value.limit })
  }

  /**
   * Find an upload by senderId in the current list
   */
  function findUpload(senderId: string): Upload | undefined {
    return uploads.value.find((u) => u.senderId === senderId)
  }

  return {
    // State
    uploads: computed(() => uploads.value),
    currentUpload: computed(() => currentUpload.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    pagination: computed(() => pagination.value),

    // Actions
    fetchUploads,
    fetchUploadDetail,
    triggerTranslation,
    deleteUpload,
    refresh,
    loadMore,
    findUpload,
  }
}
