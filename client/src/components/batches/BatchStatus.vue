<template>
  <span
    :class="statusClass"
    class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
  >
    {{ statusIcon }} {{ statusLabel }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Batch } from '@/types/api'

const props = defineProps<{
  batch: Batch
}>()

const statusLabel = computed(() => {
  switch (props.batch.status) {
    case 'pending':
      return 'Pending'
    case 'submitted':
      return 'Submitted'
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'partially_failed':
      return 'Partially Failed'
    default:
      return props.batch.status
  }
})

const statusIcon = computed(() => {
  switch (props.batch.status) {
    case 'pending':
      return '⏸'
    case 'submitted':
      return '📤'
    case 'processing':
      return '⏳'
    case 'completed':
      return '✅'
    case 'failed':
      return '❌'
    case 'cancelled':
      return '🚫'
    case 'partially_failed':
      return '⚠️'
    default:
      return '●'
  }
})

const statusClass = computed(() => {
  switch (props.batch.status) {
    case 'pending':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    case 'submitted':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    case 'processing':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    case 'cancelled':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    case 'partially_failed':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
  }
})
</script>
