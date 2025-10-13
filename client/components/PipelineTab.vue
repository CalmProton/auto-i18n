<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { usePipeline, useRefreshInterval } from '../composables'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { RefreshCw, Search, Workflow } from 'lucide-vue-next'
import ChangeSessionCard from './changes/ChangeSessionCard.vue'
import { Skeleton } from './ui/skeleton'
import type { ChangeSession, Upload } from '../types/api'

const {
  filteredUploads,
  loading,
  error,
  filters,
  stats,
  fetchUploads,
  processSession,
  finalizeSession,
  deleteSession,
  retryBatchOutput,
  retryPR,
  resetSession
} = usePipeline()

// Adapter function to convert Upload to ChangeSession format for the card
const adaptUploadToChangeSession = (upload: Upload): ChangeSession => {
  const defaultCommit = {
    sha: '',
    shortSha: '',
    message: 'Initial upload',
    author: '',
    timestamp: upload.createdAt,
  }

  const defaultSteps = {
    uploaded: { completed: true, timestamp: upload.createdAt },
    batchCreated: { completed: false },
    submitted: { completed: false },
    processing: { completed: false },
    outputReceived: { completed: false },
    translationsProcessed: { completed: false },
    completed: { completed: false },
    prCreated: { completed: false },
  }

  return {
    sessionId: upload.senderId,
    repositoryName: upload.repository ? `${upload.repository.owner}/${upload.repository.name}` : upload.senderId,
    repository: {
      owner: upload.repository?.owner || '',
      name: upload.repository?.name || '',
      baseBranch: 'main',
    },
    commit: upload.commit || defaultCommit,
    status: upload.pipelineStatus || 'uploaded',
    automationMode: upload.automationMode || 'manual',
    sourceLocale: upload.sourceLocale,
    targetLocales: upload.targetLocales,
    changeCount: upload.changeCount || { added: 0, modified: 0, deleted: 0, total: 0 },
    progress: {
      current: upload.translationProgress?.completed || 0,
      total: upload.translationProgress?.total || upload.targetLocales.length,
      percentage: upload.translationProgress?.percentage || 0,
    },
    steps: upload.steps ? { ...defaultSteps, ...upload.steps } : defaultSteps,
    batchId: upload.batchIds?.[0],
    hasErrors: upload.hasErrors || false,
    errorCount: upload.errorCount || 0,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
  }
}

// Computed property to adapt all uploads to ChangeSession format
const adaptedSessions = computed(() => filteredUploads.value.map(adaptUploadToChangeSession))

// Auto-refresh every 10 seconds
const { pause, resume } = useRefreshInterval(fetchUploads, { interval: 10000 })

onMounted(() => {
  fetchUploads()
})

// Pause refresh when user is interacting
watch(() => filters.value.search, () => {
  pause()
  setTimeout(resume, 3000) // Resume after 3 seconds of no typing
})

const handleProcess = async (senderId: string) => {
  pause()
  try {
    await processSession(senderId)
  } finally {
    resume()
  }
}

const handleFinalize = async (senderId: string) => {
  pause()
  try {
    await finalizeSession(senderId)
  } finally {
    resume()
  }
}

const handleDelete = async (senderId: string) => {
  pause()
  try {
    await deleteSession(senderId)
  } finally {
    resume()
  }
}

const handleRetryBatchOutput = async (senderId: string) => {
  pause()
  try {
    await retryBatchOutput(senderId)
  } finally {
    resume()
  }
}

const handleRetryPR = async (senderId: string) => {
  pause()
  try {
    await retryPR(senderId)
  } finally {
    resume()
  }
}

const handleResetSession = async (senderId: string, full = false) => {
  pause()
  try {
    await resetSession(senderId, full)
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
        <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Workflow class="h-6 w-6" />
          Translation Pipeline
        </h2>
        <p class="text-sm text-muted-foreground mt-1">
          All translation workflows: full uploads and incremental changes
        </p>
      </div>

      <Button @click="fetchUploads" :disabled="loading" variant="outline" size="sm">
        <RefreshCw :class="['h-4 w-4', { 'animate-spin': loading }]" />
      </Button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-6 gap-4">
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.total }}</div>
        <div class="text-xs text-muted-foreground">Total Sessions</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.bySessionType?.['full-upload'] || 0 }}</div>
        <div class="text-xs text-muted-foreground">Full Uploads</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.bySessionType?.['change-session'] || 0 }}</div>
        <div class="text-xs text-muted-foreground">Changes</div>
      </div>
      <div class="rounded-lg border p-4">
        <div class="text-2xl font-bold">{{ stats.byStatus.processing || 0 }}</div>
        <div class="text-xs text-muted-foreground">Processing</div>
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

    <!-- Pipeline Sessions List -->
    <div v-if="loading && filteredUploads.length === 0" class="space-y-4">
      <Skeleton class="h-48 w-full" v-for="i in 3" :key="i" />
    </div>

    <div v-else-if="filteredUploads.length === 0" class="text-center py-12">
      <Workflow class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 class="text-lg font-medium mb-2">No pipeline sessions found</h3>
      <p class="text-sm text-muted-foreground">
        Sessions will appear here when you upload files or trigger workflow changes
      </p>
    </div>

    <div v-else class="space-y-4">
      <ChangeSessionCard
        v-for="session in adaptedSessions"
        :key="session.sessionId"
        :session="session"
        @process="(id) => handleProcess(id)"
        @finalize="(id) => handleFinalize(id)"
        @delete="(id) => handleDelete(id)"
        @retry-batch-output="(id) => handleRetryBatchOutput(id)"
        @retry-pr="(id) => handleRetryPR(id)"
        @reset-session="(id, full) => handleResetSession(id, full)"
        @refresh="fetchUploads"
      />
    </div>
  </div>
</template>
