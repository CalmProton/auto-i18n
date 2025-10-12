<template>
  <div class="space-y-4">
    <BatchCard
      v-for="batch in batches"
      :key="batch.batchId"
      :batch="batch"
      @refresh="$emit('refresh')"
    />
  </div>
</template>

<script setup lang="ts">
import type { Batch } from '@/types/api'
import BatchCard from './BatchCard.vue'

defineProps<{
  batches: Batch[]
}>()

defineEmits<{
  refresh: []
}>()
</script>
