<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <p class="text-sm text-muted-foreground">Loading batch details...</p>
    </div>

    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="!batchDetail" class="py-4">
      <p class="text-sm text-muted-foreground">No details available</p>
    </div>

    <div v-else class="space-y-4">
      <!-- Manifest Info -->
      <div class="space-y-2">
        <div class="font-medium text-sm">Manifest</div>
        <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs font-mono">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="text-muted-foreground">Batch ID:</span>
              <span class="ml-2">{{ batchDetail.manifest.batchId }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Sender:</span>
              <span class="ml-2">{{ batchDetail.manifest.senderId }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Requests:</span>
              <span class="ml-2">{{ batchDetail.manifest.requestCount }}</span>
            </div>
            <div v-if="batchDetail.manifest.totalCharacters">
              <span class="text-muted-foreground">Characters:</span>
              <span class="ml-2">{{ batchDetail.manifest.totalCharacters.toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Files Info -->
      <div class="space-y-2">
        <div class="font-medium text-sm">Files</div>
        <div class="space-y-1">
          <div class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            <span class="flex items-center gap-1">
              <Icon icon="mdi:file-document" :size="16" />
              Input
            </span>
            <span :class="batchDetail.files.input.exists ? 'text-green-600' : 'text-gray-400'" class="flex items-center gap-1">
              <Icon :icon="batchDetail.files.input.exists ? 'mdi:check' : 'mdi:close'" :size="16" />
              {{ batchDetail.files.input.exists ? 'Available' : 'Not found' }}
            </span>
          </div>
          <div class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            <span class="flex items-center gap-1">
              <Icon icon="mdi:file-download" :size="16" />
              Output
            </span>
            <span :class="batchDetail.files.output.exists ? 'text-green-600' : 'text-gray-400'" class="flex items-center gap-1">
              <Icon :icon="batchDetail.files.output.exists ? 'mdi:check' : 'mdi:close'" :size="16" />
              {{ batchDetail.files.output.exists ? 'Available' : 'Not found' }}
            </span>
          </div>
          <div class="flex items-center justify-between p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            <span class="flex items-center gap-1">
              <Icon icon="mdi:alert-circle" :size="16" />
              Errors
            </span>
            <span :class="batchDetail.files.error.exists ? 'text-red-600' : 'text-gray-400'" class="flex items-center gap-1">
              <Icon :icon="batchDetail.files.error.exists ? 'mdi:check' : 'mdi:close'" :size="16" />
              {{ batchDetail.files.error.exists ? `${batchDetail.files.error.errorCount || 0} errors` : 'None' }}
            </span>
          </div>
        </div>
      </div>

      <!-- OpenAI Status -->
      <div v-if="batchDetail.openAiStatus" class="space-y-2">
        <div class="font-medium text-sm">OpenAI Status</div>
        <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs">
          <div class="space-y-1">
            <div><span class="text-muted-foreground">Status:</span> {{ batchDetail.openAiStatus.status }}</div>
            <div v-if="batchDetail.openAiStatus.request_counts">
              <span class="text-muted-foreground">Completed:</span> {{ batchDetail.openAiStatus.request_counts.completed }}
              / {{ batchDetail.openAiStatus.request_counts.total }}
            </div>
          </div>
        </div>
      </div>

      <!-- Request Sample (first 5) -->
      <div v-if="batchDetail.requests?.length" class="space-y-2">
        <div class="font-medium text-sm">Requests ({{ batchDetail.requests.length }} total)</div>
        <div class="space-y-1 max-h-64 overflow-y-auto">
          <div
            v-for="(request, index) in batchDetail.requests.slice(0, 5)"
            :key="index"
            class="p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs"
          >
            <div class="font-mono">
              {{ request.custom_id }}
            </div>
          </div>
          <div v-if="batchDetail.requests.length > 5" class="text-xs text-muted-foreground text-center py-2">
            ... and {{ batchDetail.requests.length - 5 }} more
          </div>
        </div>
      </div>

      <!-- Errors Sample (if any) -->
      <div v-if="batchDetail.errors?.length" class="space-y-2">
        <div class="font-medium text-sm text-red-600">Failed Requests ({{ batchDetail.errors.length }})</div>
        <div class="space-y-1 max-h-64 overflow-y-auto">
          <div
            v-for="(error, index) in batchDetail.errors.slice(0, 5)"
            :key="index"
            class="p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs"
          >
            <div class="font-mono">{{ error.custom_id }}</div>
            <div class="text-red-600 mt-1">{{ error.error?.message || 'Unknown error' }}</div>
          </div>
          <div v-if="batchDetail.errors.length > 5" class="text-xs text-muted-foreground text-center py-2">
            ... and {{ batchDetail.errors.length - 5 }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useBatches } from '@/composables'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Icon from '../Icon.vue'

const props = defineProps<{
  batchId: string
  senderId: string
}>()

const { currentBatch: batchDetail, loading, error, fetchBatchDetail } = useBatches()

onMounted(() => {
  fetchBatchDetail(props.senderId, props.batchId)
})
</script>
