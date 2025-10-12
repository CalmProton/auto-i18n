<template>
  <div
    class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
    :class="badgeClass"
  >
    {{ count }}/{{ expected }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  count: number
  expected: number
}>()

const badgeClass = computed(() => {
  if (props.count === props.expected && props.expected > 0) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  }
  if (props.count > 0 && props.count < props.expected) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  }
  if (props.expected === 0) {
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
})
</script>
