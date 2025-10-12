<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <CardTitle class="flex items-center gap-2 flex-wrap">
            <span class="font-mono text-sm">{{ batch.batchId }}</span>
            <BatchStatus :batch="batch" />
          </CardTitle>
          <CardDescription class="mt-2">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold font-mono text-xs">{{ batch.senderId }}</span>
                <span v-if="batch.repositoryName" class="text-xs">• {{ batch.repositoryName }}</span>
              </div>
              <div class="text-xs">
                Created {{ formatDate(batch.createdAt) }}
                <span v-if="batch.submittedAt"> • Submitted {{ formatDate(batch.submittedAt) }}</span>
                <span v-if="batch.completedAt"> • Completed {{ formatDate(batch.completedAt) }}</span>
              </div>
            </div>
          </CardDescription>
        </div>
        
        <BatchActions
          :batch="batch"
          :is-expanded="isExpanded"
          @toggle-expand="isExpanded = !isExpanded"
          @refresh="$emit('refresh')"
        />
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Batch Metadata -->
      <BatchMetadata :batch="batch" />

      <!-- Expandable Details -->
      <div v-if="isExpanded" class="pt-4 border-t">
        <BatchDetails :batch-id="batch.batchId" :sender-id="batch.senderId" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Batch } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import BatchStatus from './BatchStatus.vue'
import BatchMetadata from './BatchMetadata.vue'
import BatchActions from './BatchActions.vue'
import BatchDetails from './BatchDetails.vue'

defineProps<{
  batch: Batch
}>()

defineEmits<{
  refresh: []
}>()

const isExpanded = ref(false)

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  
  return date.toLocaleDateString()
}
</script>
