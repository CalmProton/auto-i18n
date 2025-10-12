<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <CardTitle class="flex items-center gap-2">
            <span class="font-mono text-sm">{{ upload.senderId }}</span>
            <span
              :class="statusClass"
              class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
            >
              {{ statusLabel }}
            </span>
          </CardTitle>
          <CardDescription class="mt-2">
            <div class="space-y-1">
              <div v-if="upload.repository" class="flex items-center gap-2">
                <span class="font-semibold">{{ upload.repository.owner }}/{{ upload.repository.name }}</span>
              </div>
              <div class="text-xs">
                Created {{ formatDate(upload.createdAt) }} • Updated {{ formatDate(upload.updatedAt) }}
              </div>
            </div>
          </CardDescription>
        </div>
        
        <UploadActions
          :upload="upload"
          :is-expanded="isExpanded"
          @toggle-expand="isExpanded = !isExpanded"
          @refresh="$emit('refresh')"
        />
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Metadata summary -->
      <UploadMetadata :upload="upload" />

      <!-- Expandable file list -->
      <div v-if="isExpanded" class="pt-4 border-t">
        <FilesList :sender-id="upload.senderId" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Upload } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import UploadMetadata from './UploadMetadata.vue'
import UploadActions from './UploadActions.vue'
import FilesList from './FilesList.vue'

const props = defineProps<{
  upload: Upload
}>()

defineEmits<{
  refresh: []
}>()

const isExpanded = ref(false)

const statusLabel = computed(() => {
  switch (props.upload.status) {
    case 'uploaded':
      return 'Uploaded'
    case 'batched':
      return 'Batched'
    case 'translating':
      return 'Translating'
    case 'completed':
      return 'Completed'
    default:
      return props.upload.status
  }
})

const statusClass = computed(() => {
  switch (props.upload.status) {
    case 'uploaded':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    case 'batched':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    case 'translating':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
  }
})

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
