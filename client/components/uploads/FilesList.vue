<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <p class="text-sm text-muted-foreground">Loading files...</p>
    </div>

    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="!uploadDetail" class="py-4">
      <p class="text-sm text-muted-foreground">No file information available</p>
    </div>

    <div v-else class="space-y-4">
      <!-- Content Files -->
      <div v-if="uploadDetail.files.content?.length">
        <div class="font-medium text-sm mb-2 flex items-center gap-1">
          <Icon icon="mdi:file-document-multiple" :size="16" />
          Content Files ({{ uploadDetail.files.content.length }})
        </div>
        <div class="space-y-1">
          <div
            v-for="file in uploadDetail.files.content"
            :key="file.path"
            class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
          >
            <span class="font-mono text-xs">{{ file.name }}</span>
            <span class="text-xs text-muted-foreground">{{ formatBytes(file.size) }}</span>
          </div>
        </div>
      </div>

      <!-- Global Files -->
      <div v-if="uploadDetail.files.global?.length">
        <div class="font-medium text-sm mb-2 flex items-center gap-1">
          <Icon icon="mdi:web" :size="16" />
          Global Files ({{ uploadDetail.files.global.length }})
        </div>
        <div class="space-y-1">
          <div
            v-for="file in uploadDetail.files.global"
            :key="file.path"
            class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
          >
            <span class="font-mono text-xs">{{ file.name }}</span>
            <span class="text-xs text-muted-foreground">{{ formatBytes(file.size) }}</span>
          </div>
        </div>
      </div>

      <!-- Page Files -->
      <div v-if="uploadDetail.files.page?.length">
        <div class="font-medium text-sm mb-2 flex items-center gap-1">
          <Icon icon="mdi:file-multiple" :size="16" />
          Page Files ({{ uploadDetail.files.page.length }})
        </div>
        <div class="space-y-1">
          <div
            v-for="file in uploadDetail.files.page"
            :key="file.path"
            class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
          >
            <span class="font-mono text-xs">{{ file.name }}</span>
            <span class="text-xs text-muted-foreground">{{ formatBytes(file.size) }}</span>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="!hasAnyFiles" class="text-center py-4">
        <p class="text-sm text-muted-foreground">No files found</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUploads } from '@/composables'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Icon from '../Icon.vue'

const props = defineProps<{
  senderId: string
}>()

const { currentUpload: uploadDetail, loading, error, fetchUploadDetail } = useUploads()

onMounted(() => {
  fetchUploadDetail(props.senderId)
})

const hasAnyFiles = computed(() => {
  if (!uploadDetail.value?.files) return false
  return (
    (uploadDetail.value.files.content?.length ?? 0) > 0 ||
    (uploadDetail.value.files.global?.length ?? 0) > 0 ||
    (uploadDetail.value.files.page?.length ?? 0) > 0
  )
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
</script>
