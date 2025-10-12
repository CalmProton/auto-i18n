<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold mb-1">Ready for Pull Request</h3>
      <p class="text-sm text-muted-foreground">
        {{ sessions.length }} session{{ sessions.length !== 1 ? 's' : '' }} with completed translations
      </p>
    </div>

    <div class="space-y-4">
      <GitHubSessionCard
        v-for="session in sessions"
        :key="session.senderId"
        :session="session"
        @create-pr="$emit('create-pr', $event)"
        @refresh="$emit('refresh')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitHubSession } from '@/types/api'
import GitHubSessionCard from './GitHubSessionCard.vue'

defineProps<{
  sessions: GitHubSession[]
}>()

defineEmits<{
  'create-pr': [payload: {
    session: GitHubSession
    locales: string[]
    title: string
    description: string
  }]
  refresh: []
}>()
</script>
