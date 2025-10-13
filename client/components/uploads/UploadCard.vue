<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <CardTitle class="font-mono text-sm">{{ upload.senderId }}</CardTitle>
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
import { ref } from 'vue'
import type { Upload } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import UploadMetadata from './UploadMetadata.vue'
import UploadActions from './UploadActions.vue'
import FilesList from './FilesList.vue'

defineProps<{
  upload: Upload
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
