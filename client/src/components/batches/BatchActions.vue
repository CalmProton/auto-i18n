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
      variant="default"
      size="sm"
      @click="showRetryDialog = true"
      :disabled="isRetrying"
    >
      <Icon v-if="!isRetrying" icon="mdi:reload" :size="18" class="mr-1" />
      {{ isRetrying ? 'Creating...' : 'Retry Failed' }}
    </Button>

    <!-- Retry Dialog -->
    <Dialog v-model:open="showRetryDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retry Failed Requests</DialogTitle>
          <DialogDescription>
            Create a new batch to retry {{ batch.errorCount }} failed request(s). You can optionally use a different model.
          </DialogDescription>
        </DialogHeader>
        <div class="py-4 space-y-4">
          <div class="space-y-2">
            <Label for="retry-model">Model (optional)</Label>
            <Input
              id="retry-model"
              v-model="retryModel"
              placeholder="Leave empty to use same model"
            />
            <p class="text-xs text-muted-foreground">
              Current model: {{ batch.model }}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showRetryDialog = false">
            Cancel
          </Button>
          <Button @click="handleRetryConfirm" :disabled="isRetrying">
            {{ isRetrying ? 'Creating...' : 'Create Retry Batch' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
const showRetryDialog = ref(false)
const retryModel = ref('')

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

async function handleRetryConfirm() {
  isRetrying.value = true
  try {
    const result = await retryBatch(props.batch.senderId, props.batch.batchId, {
      errorFileName: props.batch.errorFileName,
      model: retryModel.value || undefined,
    })
    if (result) {
      showRetryDialog.value = false
      retryModel.value = ''
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
