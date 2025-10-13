<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useChanges, useRefreshInterval } from '../composables'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { RefreshCw, Search, GitBranch } from 'lucide-vue-next'
import ChangeSessionCard from './changes/ChangeSessionCard.vue'
import { Skeleton } from './ui/skeleton'

const {
  filteredChanges,
  loading,
  error,
  filters,
  stats,
  fetchChanges,
  processChange,
  finalizeChange,
  deleteChange,
  retryBatchOutput,
  retryPR,
  resetSession
} = useChanges()

// Auto-refresh every 10 seconds
const { pause, resume } = useRefreshInterval(fetchChanges, { interval: 10000 })

onMounted(() => {
  fetchChanges()
})

// Pause refresh when user is interacting
watch(() => filters.value.search, () => {
  pause()
  setTimeout(resume, 3000) // Resume after 3 seconds of no typing
})

const handleProcess = async (sessionId: string) => {
  pause()
  try {
    await processChange(sessionId)
  } finally {
    resume()
  }
}

const handleFinalize = async (sessionId: string) => {
  pause()
  try {
    await finalizeChange(sessionId)
  } finally {
    resume()
  }
}

const handleDelete = async (sessionId: string) => {
  pause()
  try {
    await deleteChange(sessionId)
  } finally {
    resume()
  }
}

const handleRetryBatchOutput = async (sessionId: string) => {
  pause()
  try {
    await retryBatchOutput(sessionId)
  } finally {
    resume()
  }
}

const handleRetryPR = async (sessionId: string) => {
  pause()
  try {
    await retryPR(sessionId)
  } finally {
    resume()
  }
}

const handleResetSession = async (sessionId: string, full = false) => {
  pause()
  try {
    await resetSession(sessionId, full)
  } finally {
    resume()
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <GitBranch class="h-6 w-6" />
          Translation Changes
        </h2>
        <p class="text-sm text-muted-foreground mt-1">
          Automatic incremental translation updates from repository changes
        </p>
      </div>

      <Button @click="fetchChanges" :disabled="loading" variant="outline" size="sm">
        <RefreshCw :class="['h-4 w-4', { 'animate-spin': loading }]" />
      </Button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-5 gap-4">
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.total }}</div>
        <div class="text-xs text-muted-foreground">Total Changes</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.byStatus.processing || 0 }}</div>
        <div class="text-xs text-muted-foreground">Processing</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.byStatus.completed || 0 }}</div>
        <div class="text-xs text-muted-foreground">Completed</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.byAutomation.auto || 0 }}</div>
        <div class="text-xs text-muted-foreground">Automated</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold text-destructive">{{ stats.withErrors }}</div>
        <div class="text-xs text-muted-foreground">With Errors</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-4">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          v-model="filters.search"
          placeholder="Search by session ID, repository, commit message, or author..."
          class="pl-9"
        />
      </div>

      <Select v-model="filters.status">
        <SelectTrigger class="w-[180px]">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="uploaded">Uploaded</SelectItem>
          <SelectItem value="batch-created">Batch Created</SelectItem>
          <SelectItem value="submitted">Submitted</SelectItem>
          <SelectItem value="processing">Processing</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="pr-created">PR Created</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
      {{ error }}
    </div>

    <!-- Changes List -->
    <div v-if="loading && filteredChanges.length === 0" class="space-y-4">
      <Skeleton class="h-48 w-full" v-for="i in 3" :key="i" />
    </div>

    <div v-else-if="filteredChanges.length === 0" class="text-center py-12">
      <GitBranch class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 class="text-lg font-medium mb-2">No changes found</h3>
      <p class="text-sm text-muted-foreground">
        Changes will appear here when you push updates to monitored files
      </p>
    </div>

    <div v-else class="space-y-4">
      <ChangeSessionCard
        v-for="session in filteredChanges"
        :key="session.sessionId"
        :session="session"
        @process="handleProcess"
        @finalize="handleFinalize"
        @delete="handleDelete"
        @retry-batch-output="handleRetryBatchOutput"
        @retry-pr="handleRetryPR"
        @reset-session="handleResetSession"
        @refresh="fetchChanges"
      />
    </div>
  </div>
</template>
