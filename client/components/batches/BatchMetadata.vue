<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Locales -->
    <div class="space-y-2">
      <div class="text-sm font-medium text-muted-foreground">Locales</div>
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">Source:</span>
          <span class="px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded text-sm">
            {{ batch.sourceLocale }}
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

    <!-- Types and Counts -->
    <div class="space-y-2">
      <div class="text-sm font-medium text-muted-foreground">Details</div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div class="font-semibold">{{ batch.requestCount }}</div>
          <div class="text-xs text-muted-foreground">Requests</div>
        </div>
        <div v-if="batch.errorCount">
          <div class="font-semibold text-red-600">{{ batch.errorCount }}</div>
          <div class="text-xs text-muted-foreground">Errors</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-1 mt-2">
        <span
          v-for="type in batch.types"
          :key="type"
          class="px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs"
        >
          {{ type }}
        </span>
      </div>
    </div>

    <!-- Progress Bar (if processing or completed) -->
    <div v-if="batch.progress" class="col-span-full">
      <div class="text-sm font-medium text-muted-foreground mb-2">Progress</div>
      <div class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span>{{ batch.progress.completed }} / {{ batch.progress.total }} requests</span>
          <span class="font-semibold">{{ batch.progress.percentage }}%</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            class="h-2 rounded-full transition-all"
            :class="progressBarClass"
            :style="{ width: `${batch.progress.percentage}%` }"
          />
        </div>
        <div v-if="batch.progress.errorCount" class="text-xs text-red-600">
          {{ batch.progress.errorCount }} failed requests
        </div>
      </div>
    </div>

    <!-- Model and OpenAI Info -->
    <div class="col-span-full">
      <div class="text-sm font-medium text-muted-foreground mb-2">Batch Information</div>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span class="font-semibold">Model:</span>
          <span class="ml-1">{{ batch.model }}</span>
        </div>
        <div v-if="batch.openAiBatchId">
          <span class="font-semibold">OpenAI ID:</span>
          <span class="ml-1 font-mono">{{ batch.openAiBatchId }}</span>
        </div>
        <div v-if="batch.openAiStatus">
          <span class="font-semibold">OpenAI Status:</span>
          <span class="ml-1">{{ batch.openAiStatus }}</span>
        </div>
        <div>
          <span class="font-semibold">Output:</span>
          <span class="ml-1 flex items-center gap-1">
            <Icon :icon="batch.hasOutput ? 'mdi:check' : 'mdi:close'" :size="14" />
            {{ batch.hasOutput ? 'Available' : 'Not available' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import type { Batch } from '@/types/api'

const props = defineProps<{
  batch: Batch
}>()

const displayLocales = computed(() => {
  return props.batch.targetLocales.slice(0, 8)
})

const remainingCount = computed(() => {
  return Math.max(0, props.batch.targetLocales.length - 8)
})

const progressBarClass = computed(() => {
  if (props.batch.status === 'completed') return 'bg-green-600'
  if (props.batch.status === 'failed' || props.batch.status === 'partially_failed') return 'bg-red-600'
  return 'bg-blue-600'
})
</script>
