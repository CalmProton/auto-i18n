/**
 * useBatches Composable
 * Manages batch operations and state
 */

import { ref, computed } from 'vue'
import { api } from '../lib/api-client'
import type {
  Batch,
  BatchesResponse,
  BatchStatus,
  ProcessBatchRequest,
  RetryBatchRequest,
} from '../types/api'
import { useToast } from './useToast'

const batches = ref<Batch[]>([])
const currentBatch = ref<any>(null) // Will be typed properly when we have batch detail response
const loading = ref(false)
const error = ref<string | null>(null)
const pagination = ref({
  total: 0,
  limit: 50,
  offset: 0,
  hasMore: false,
})

export function useBatches() {
  const toast = useToast()

  /**
   * Fetch all batches with optional filtering
   */
  async function fetchBatches(options?: {
    status?: BatchStatus | 'all'
    senderId?: string
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

      if (options?.senderId) {
        params.senderId = options.senderId
      }

      const response = await api.get<BatchesResponse>('/api/batches', params)
      batches.value = response.batches
      pagination.value = response.pagination
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch batches'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch batches:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch detailed information about a specific batch
   */
  async function fetchBatchDetail(senderId: string, batchId: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<any>(`/api/batches/${senderId}/${batchId}`)
      currentBatch.value = response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch batch details'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch batch detail:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Process a completed batch output
   */
  async function processBatchOutput(
    senderId: string,
    batchId: string,
    request: ProcessBatchRequest
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      await api.post(`/api/batches/${senderId}/${batchId}/process`, request)
      toast.success('Batch Processed', 'Batch output has been processed successfully')
      
      // Refresh the batch detail
      await fetchBatchDetail(senderId, batchId)
      await fetchBatches()
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process batch output'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to process batch output:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a retry batch from failed requests
   */
  async function retryBatch(
    senderId: string,
    batchId: string,
    request: RetryBatchRequest
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<any>(`/api/batches/${senderId}/${batchId}/retry`, request)
      toast.success('Retry Batch Created', `New batch created: ${response.batchId || 'unknown'}`)
      
      // Refresh batches list
      await fetchBatches()
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create retry batch'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to create retry batch:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete a batch
   */
  async function deleteBatch(senderId: string, batchId: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      await api.delete(`/api/batches/${senderId}/${batchId}`)
      toast.success('Batch Deleted', 'Batch has been deleted')
      
      // Remove from local list
      batches.value = batches.value.filter((b) => b.batchId !== batchId)
      
      // Clear current batch if it was the deleted one
      if (currentBatch.value?.batch?.batchId === batchId) {
        currentBatch.value = null
      }
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete batch'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to delete batch:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Refresh the batches list
   */
  async function refresh(): Promise<void> {
    await fetchBatches({ offset: pagination.value.offset })
  }

  /**
   * Load next page of batches
   */
  async function loadMore(): Promise<void> {
    if (!pagination.value.hasMore) return
    await fetchBatches({ offset: pagination.value.offset + pagination.value.limit })
  }

  /**
   * Find a batch by ID in the current list
   */
  function findBatch(batchId: string): Batch | undefined {
    return batches.value.find((b) => b.batchId === batchId)
  }

  /**
   * Get processing batches that need monitoring
   */
  function getProcessingBatches(): Batch[] {
    return batches.value.filter((b) => 
      b.status === 'submitted' || b.status === 'processing'
    )
  }

  return {
    // State
    batches: computed(() => batches.value),
    currentBatch: computed(() => currentBatch.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    pagination: computed(() => pagination.value),

    // Actions
    fetchBatches,
    fetchBatchDetail,
    processBatchOutput,
    retryBatch,
    deleteBatch,
    refresh,
    loadMore,
    findBatch,
    getProcessingBatches,
  }
}
