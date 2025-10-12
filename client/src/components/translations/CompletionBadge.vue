<template>
  <span
    :class="badgeClass"
    class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
  >
    {{ icon }} {{ percentage }}%
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  percentage: number
}>()

const icon = computed(() => {
  if (props.percentage === 100) return '✅'
  if (props.percentage >= 75) return '🟢'
  if (props.percentage >= 50) return '🟡'
  if (props.percentage >= 25) return '🟠'
  return '🔴'
})

const badgeClass = computed(() => {
  if (props.percentage === 100) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (props.percentage >= 75) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (props.percentage >= 50) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  if (props.percentage >= 25) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
})
</script>
