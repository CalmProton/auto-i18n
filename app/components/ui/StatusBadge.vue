<template>
  <span
    class="inline-block px-2 py-0.5 text-xs uppercase tracking-wider border font-mono"
    :class="statusClass"
  >{{ status }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: string }>()

const statusClass = computed(() => {
  switch (props.status) {
    case 'pending':    return 'status-pending'
    case 'processing': return 'status-processing'
    case 'completed':  return 'status-completed'
    case 'failed':     return 'status-failed'
    case 'expired':    return 'status-expired'
    case 'submitted':  return 'text-info border-info'
    case 'running':    return 'status-processing'
    default:           return 'status-pending'
  }
})
</script>
