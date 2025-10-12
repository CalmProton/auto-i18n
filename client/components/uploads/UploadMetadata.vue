<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Source and Target Locales -->
    <div class="space-y-2">
      <div class="text-sm font-medium text-muted-foreground">Locales</div>
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">Source:</span>
          <span class="px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded text-sm">
            {{ upload.sourceLocale }}
          </span>
        </div>
        <div class="flex items-start gap-2">
          <span class="text-sm font-semibold">Target:</span>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="locale in displayLocales"
              :key="locale"
              class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs"
            >
              {{ locale }}
            </span>
            <span
              v-if="remainingCount > 0"
              class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-semibold"
            >
              +{{ remainingCount }} more
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- File Counts -->
    <div class="space-y-2">
      <div class="text-sm font-medium text-muted-foreground">Files</div>
      <div class="grid grid-cols-4 gap-2 text-sm">
        <div class="text-center">
          <div class="font-semibold text-blue-600">{{ upload.fileCount.content }}</div>
          <div class="text-xs text-muted-foreground">Content</div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-green-600">{{ upload.fileCount.global }}</div>
          <div class="text-xs text-muted-foreground">Global</div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-purple-600">{{ upload.fileCount.page }}</div>
          <div class="text-xs text-muted-foreground">Page</div>
        </div>
        <div class="text-center">
          <div class="font-semibold">{{ upload.fileCount.total }}</div>
          <div class="text-xs text-muted-foreground">Total</div>
        </div>
      </div>
    </div>

    <!-- Translation Progress (if available) -->
    <div v-if="upload.translationProgress" class="col-span-full">
      <div class="text-sm font-medium text-muted-foreground mb-2">Translation Progress</div>
      <div class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span>{{ upload.translationProgress.completed }} / {{ upload.translationProgress.total }} locales</span>
          <span class="font-semibold">{{ upload.translationProgress.percentage }}%</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full transition-all"
            :style="{ width: `${upload.translationProgress.percentage}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Batch and Job IDs -->
    <div v-if="upload.batchIds?.length || upload.jobIds?.length" class="col-span-full">
      <div class="text-sm font-medium text-muted-foreground mb-2">Related Items</div>
      <div class="flex gap-4 text-xs">
        <div v-if="upload.batchIds?.length">
          <span class="font-semibold">Batches:</span>
          <span class="ml-1">{{ upload.batchIds.length }}</span>
        </div>
        <div v-if="upload.jobIds?.length">
          <span class="font-semibold">Jobs:</span>
          <span class="ml-1">{{ upload.jobIds.length }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Upload } from '@/types/api'

const props = defineProps<{
  upload: Upload
}>()

const displayLocales = computed(() => {
  return props.upload.targetLocales.slice(0, 8)
})

const remainingCount = computed(() => {
  return Math.max(0, props.upload.targetLocales.length - 8)
})
</script>
