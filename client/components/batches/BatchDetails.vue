<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <p class="text-sm text-muted-foreground">Loading batch details...</p>
    </div>

    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="!batchDetail || !batchDetail.batch" class="py-4">
      <p class="text-sm text-muted-foreground">No details available</p>
    </div>

    <div v-else class="space-y-4">
      <!-- Batch Info -->
      <div class="space-y-2">
        <div class="font-medium text-sm">Batch Information</div>
        <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs font-mono">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="text-muted-foreground">Batch ID:</span>
              <span class="ml-2">{{ batchDetail.batch.batchId }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Sender:</span>
              <span class="ml-2">{{ batchDetail.batch.senderId }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Requests:</span>
              <span class="ml-2">{{ batchDetail.batch.requestCount }}</span>
            </div>
            <div v-if="batchDetail.batch.openAiBatchId">
              <span class="text-muted-foreground">OpenAI ID:</span>
              <span class="ml-2">{{ batchDetail.batch.openAiBatchId }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Source:</span>
              <span class="ml-2">{{ batchDetail.batch.sourceLocale }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Target:</span>
              <span class="ml-2">{{ batchDetail.batch.targetLocales.join(', ') }}</span>
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

      <!-- Progress -->
      <div v-if="batchDetail.batch.progress" class="space-y-2">
        <div class="font-medium text-sm">Progress</div>
        <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs">
          <div class="space-y-1">
            <div>
              <span class="text-muted-foreground">Completed:</span> 
              {{ batchDetail.batch.progress.completed }} / {{ batchDetail.batch.progress.total }}
              ({{ batchDetail.batch.progress.percentage }}%)
            </div>
            <div v-if="batchDetail.batch.progress.errorCount > 0" class="text-red-600">
              <span class="text-muted-foreground">Errors:</span> {{ batchDetail.batch.progress.errorCount }}
            </div>
          </div>
        </div>
      </div>

      <!-- OpenAI Status -->
      <div v-if="batchDetail.batch.openAiStatus" class="space-y-2">
        <div class="font-medium text-sm">OpenAI Status</div>
        <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs">
          <div class="space-y-1">
            <div><span class="text-muted-foreground">Status:</span> {{ batchDetail.batch.openAiStatus }}</div>
          </div>
        </div>
      </div>

      <!-- Unique Errors -->
      <div v-if="batchDetail.uniqueErrors?.length" class="space-y-2">
        <div class="font-medium text-sm text-red-600">
          Unique Errors ({{ batchDetail.uniqueErrors.length }} type{{ batchDetail.uniqueErrors.length > 1 ? 's' : '' }})
        </div>
        <div class="space-y-2">
          <div
            v-for="(error, index) in batchDetail.uniqueErrors"
            :key="index"
            class="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800"
          >
            <div class="flex items-start justify-between mb-2">
              <div class="flex items-center gap-2">
                <Icon icon="mdi:alert-circle" class="text-red-600" :size="16" />
                <span class="font-mono text-xs font-semibold text-red-700 dark:text-red-400">
                  {{ error.code }}
                </span>
              </div>
              <span class="text-xs bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded text-red-700 dark:text-red-300">
                {{ error.count }} occurrence{{ error.count > 1 ? 's' : '' }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground mb-1">
              Type: <span class="font-mono">{{ error.type }}</span>
            </div>
            <div class="text-xs text-red-600 dark:text-red-400">
              {{ error.message }}
            </div>
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
