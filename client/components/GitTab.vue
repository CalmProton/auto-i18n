<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold">Git Integration</h2>
        <p class="text-sm text-muted-foreground mt-1">
          View all translation sessions and create pull requests
        </p>
      </div>
      <Button @click="refreshSessions" :disabled="loading" variant="outline">
        <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
        {{ loading ? 'Refreshing...' : 'Refresh' }}
      </Button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-4 gap-4">
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ sessions.length }}</div>
        <div class="text-xs text-muted-foreground">Total Sessions</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ readySessions.length }}</div>
        <div class="text-xs text-muted-foreground">Ready for PR</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ sessionsWithPRs.length }}</div>
        <div class="text-xs text-muted-foreground">With PR</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ totalTranslations }}</div>
        <div class="text-xs text-muted-foreground">Total Translations</div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !sessions.length" class="space-y-4">
      <Skeleton class="h-32 w-full rounded-lg" />
      <Skeleton class="h-32 w-full rounded-lg" />
    </div>

    <!-- Error State -->
    <Alert v-else-if="error" variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <AlertDescription>
        <p class="font-semibold">Failed to load GitHub sessions</p>
        <p class="text-sm">{{ error }}</p>
      </AlertDescription>
    </Alert>

    <!-- Empty State -->
    <div
      v-else-if="!sessions.length"
      class="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg"
    >
      <GitBranch class="h-16 w-16 mb-4 text-muted-foreground" />
      <h3 class="text-lg font-semibold mb-2">No Translation Sessions</h3>
      <p class="text-sm text-muted-foreground text-center max-w-md">
        Upload files or trigger changes to see translation sessions here.
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
import { RefreshCw, AlertCircle, GitBranch } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
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

const totalTranslations = computed(() => {
  return sessions.value.reduce((total, session) => {
    return total + (session.translationProgress?.completed || session.completedLocales.length)
  }, 0)
})

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
