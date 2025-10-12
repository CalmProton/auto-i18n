<template>
  <div class="space-y-4">
    <TranslationSessionCard
      v-for="session in translations"
      :key="session.senderId"
      :session="session"
      @refresh="$emit('refresh')"
    />
  </div>
</template>

<script setup lang="ts">
import type { TranslationSession } from '@/types/api'
import TranslationSessionCard from './TranslationSessionCard.vue'

defineProps<{
  translations: TranslationSession[]
}>()

defineEmits<{
  refresh: []
}>()
</script>
