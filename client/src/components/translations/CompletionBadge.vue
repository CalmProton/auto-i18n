<template>
  <span
    :class="badgeClass"
    class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium gap-1"
  >
    <Icon :icon="iconName" :size="14" :color="iconColor" />
    {{ percentage }}%
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'

const props = defineProps<{
  percentage: number
}>()

const iconName = computed(() => {
  if (props.percentage === 100) return 'mdi:check-circle'
  if (props.percentage >= 75) return 'mdi:circle'
  if (props.percentage >= 50) return 'mdi:circle'
  if (props.percentage >= 25) return 'mdi:circle'
  return 'mdi:circle'
})

const iconColor = computed(() => {
  if (props.percentage === 100) return '#22c55e'
  if (props.percentage >= 75) return '#3b82f6'
  if (props.percentage >= 50) return '#eab308'
  if (props.percentage >= 25) return '#f97316'
  return '#ef4444'
})

const badgeClass = computed(() => {
  if (props.percentage === 100) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (props.percentage >= 75) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (props.percentage >= 50) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  if (props.percentage >= 25) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
})
</script>
