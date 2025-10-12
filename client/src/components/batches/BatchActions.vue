<template>
  <div class="flex gap-2 flex-wrap">
    <Button
      variant="ghost"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      <Icon :icon="isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'" :size="20" class="mr-1" />
      Details
    </Button>
    
    <Button
      v-if="canRefresh"
      variant="outline"
      size="sm"
      @click="handleRefresh"
      :disabled="isRefreshing"
    >
      <Icon v-if="!isRefreshing" icon="mdi:refresh" :size="18" class="mr-1" />
      {{ isRefreshing ? 'Refreshing...' : 'Refresh Status' }}
    </Button>
    
    <Button
      v-if="canProcess"
      variant="default"
      size="sm"
      @click="handleProcess"
      :disabled="isProcessing"
    >
      <Icon v-if="!isProcessing" icon="mdi:cog" :size="18" class="mr-1" />
      {{ isProcessing ? 'Processing...' : 'Process Output' }}
    </Button>
    
    <Button
      v-if="canRetry"
      variant="outline"
      size="sm"
      @click="handleRetry"
      :disabled="isRetrying"
    >
      <Icon v-if="!isRetrying" icon="mdi:reload" :size="18" class="mr-1" />
      {{ isRetrying ? 'Creating...' : 'Retry Failed' }}
    </Button>
    
    <Button
      variant="destructive"
      size="sm"
      @click="handleDelete"
      :disabled="isDeleting"
    >
      <Icon v-if="!isDeleting" icon="mdi:delete" :size="18" class="mr-1" />
      {{ isDeleting ? 'Deleting...' : 'Delete' }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBatches, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
import Icon from '../Icon.vue'
import type { Batch } from '@/types/api'

const props = defineProps<{
  batch: Batch
  isExpanded: boolean
}>()

const emit = defineEmits<{
  toggleExpand: []
  refresh: []
}>()

const { fetchBatchDetail, processBatchOutput, retryBatch, deleteBatch } = useBatches()
const { success } = useToast()

const isRefreshing = ref(false)
const isProcessing = ref(false)
const isRetrying = ref(false)
const isDeleting = ref(false)

const canRefresh = computed(() => {
  return props.batch.status === 'submitted' || props.batch.status === 'processing'
})

const canProcess = computed(() => {
  return props.batch.status === 'completed' && props.batch.hasOutput && !props.batch.outputProcessed
})

const canRetry = computed(() => {
  return (props.batch.status === 'failed' || props.batch.status === 'partially_failed') && props.batch.hasErrors
})

async function handleRefresh() {
  isRefreshing.value = true
  try {
    // Re-fetch batch detail to get updated status
    await fetchBatchDetail(props.batch.senderId, props.batch.batchId)
    emit('refresh')
  } finally {
    isRefreshing.value = false
  }
}

async function handleProcess() {
  if (!confirm('Process the batch output and save translations?')) return
  
  if (!props.batch.openAiBatchId) {
    success('Process Batch', 'No OpenAI batch ID available')
    return
  }
  
  isProcessing.value = true
  try {
    const result = await processBatchOutput(props.batch.senderId, props.batch.batchId, {
      batchOutputId: props.batch.openAiBatchId
    })
    if (result) {
      emit('refresh')
    }
  } finally {
    isProcessing.value = false
  }
}

async function handleRetry() {
  if (!confirm('Create a new batch to retry failed requests?')) return
  
  isRetrying.value = true
  try {
    const result = await retryBatch(props.batch.senderId, props.batch.batchId, {})
    if (result) {
      emit('refresh')
    }
  } finally {
    isRetrying.value = false
  }
}

async function handleDelete() {
  if (!confirm(`Delete batch ${props.batch.batchId}? This action cannot be undone.`)) return
  
  isDeleting.value = true
  try {
    const result = await deleteBatch(props.batch.senderId, props.batch.batchId)
    if (result) {
      emit('refresh')
    }
  } finally {
    isDeleting.value = false
  }
}
</script>
