<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold">GitHub Integration</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Create pull requests from completed translation sessions
        </p>
      </div>
      <Button @click="refreshSessions" :disabled="loading" variant="outline">
        <span class="mr-2">🔄</span>
        {{ loading ? 'Refreshing...' : 'Refresh' }}
      </Button>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !sessions.length" class="space-y-4">
      <div class="h-32 bg-muted animate-pulse rounded-lg" />
      <div class="h-32 bg-muted animate-pulse rounded-lg" />
    </div>

    <!-- Error State -->
    <Alert v-else-if="error" variant="destructive">
      <p class="font-semibold">Failed to load GitHub sessions</p>
      <p class="text-sm">{{ error }}</p>
    </Alert>

    <!-- Empty State -->
    <div
      v-else-if="!sessions.length"
      class="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg"
    >
      <div class="text-6xl mb-4">🔀</div>
      <h3 class="text-lg font-semibold mb-2">No Sessions Ready</h3>
      <p class="text-sm text-muted-foreground text-center max-w-md">
        Complete translations first, then they'll appear here ready to create pull requests.
      </p>
    </div>

    <!-- Sessions List -->
    <div v-else class="space-y-6">
      <!-- Ready Sessions -->
      <ReadySessions
        :sessions="readySessions"
        @create-pr="handleCreatePR"
        @refresh="refreshSessions"
      />

      <!-- Existing PRs -->
      <ExistingPRsList
        v-if="sessionsWithPRs.length"
        :sessions="sessionsWithPRs"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGitHub, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import ReadySessions from './github/ReadySessions.vue'
import ExistingPRsList from './github/ExistingPRsList.vue'
import type { GitHubSession } from '@/types/api'

const { sessions, loading, error, fetchReadySessions, finalizePR } = useGitHub()
const { success } = useToast()

const readySessions = computed(() => 
  sessions.value.filter(s => !s.hasPullRequest && s.completedLocales.length > 0)
)

const sessionsWithPRs = computed(() => 
  sessions.value.filter(s => s.hasPullRequest)
)

async function refreshSessions() {
  await fetchReadySessions()
}

async function handleCreatePR(payload: {
  session: GitHubSession
  locales: string[]
  title: string
  description: string
}) {
  const result = await finalizePR(payload.session.senderId, {
    targetLocales: payload.locales,
    metadata: {
      pullRequest: {
        title: payload.title,
        body: payload.description
      }
    }
  })
  
  if (result) {
    success('Pull request created successfully!')
    await refreshSessions()
  }
}

onMounted(() => {
  fetchReadySessions()
})
</script>
