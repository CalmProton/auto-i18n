<template>
  <div class="space-y-4">
    <UploadCard
      v-for="upload in uploads"
      :key="upload.senderId"
      :upload="upload"
      @refresh="$emit('refresh')"
    />
  </div>
</template>

<script setup lang="ts">
import type { Upload } from '@/types/api'
import UploadCard from './UploadCard.vue'

defineProps<{
  uploads: Upload[]
}>()

defineEmits<{
  refresh: []
}>()
</script>
