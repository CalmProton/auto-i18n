<template>
  <div>
    <!-- Forge mode indicator -->
    <div class="border border-gray-700 mb-4">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span class="text-xs uppercase tracking-wider text-gray-400">Forge Configuration</span>
      </div>
      <div class="px-4 py-3 flex gap-6 text-sm">
        <span>
          <span class="text-gray-500 text-xs uppercase">Mode</span><br>
          <span class="text-gray-300 uppercase">{{ forgeMode }}</span>
        </span>
        <span v-if="forgeMode === 'github' || forgeMode === 'gitlab'">
          <span class="text-gray-500 text-xs uppercase">Type</span><br>
          <span class="text-gray-300">{{ forgeMode === 'github' ? 'Pull Requests' : 'Merge Requests' }}</span>
        </span>
        <span v-if="forgeMode === 'webhook'">
          <span class="text-gray-500 text-xs uppercase">Delivery</span><br>
          <span class="text-gray-300">POST to URL</span>
        </span>
        <span v-if="forgeMode === 'none'">
          <span class="text-gray-500 text-xs uppercase">Delivery</span><br>
          <span class="text-gray-300">Download via API</span>
        </span>
        <span v-if="createIssues">
          <span class="text-gray-500 text-xs uppercase">Issues</span><br>
          <span class="text-success">Enabled</span>
        </span>
      </div>
    </div>

    <!-- Sessions ready for finalize -->
    <div class="border border-gray-700 mb-6" v-if="readySessions.length > 0">
      <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 text-xs uppercase tracking-wider text-warning">
        Ready to Finalize ({{ readySessions.length }})
      </div>
      <div class="hidden md:grid grid-cols-[1.5fr_1fr_1fr_120px] gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
        <span>Sender ID</span>
        <span>Locales</span>
        <span>Created</span>
        <span></span>
      </div>
      <div
        v-for="s in readySessions"
        :key="s.id"
        class="grid grid-cols-[1.5fr_1fr_1fr_120px] gap-4 px-4 py-3 text-sm border-b border-gray-800 last:border-b-0 hover:bg-gray-900"
      >
        <span class="text-gray-300 font-mono text-xs truncate" :title="s.senderId">
          {{ s.senderId.slice(0, 20) }}{{ s.senderId.length > 20 ? '...' : '' }}
        </span>
        <span class="text-gray-400 text-xs">
          {{ s.sourceLocale }} → {{ targetCount(s) }}
        </span>
        <span class="text-gray-500 text-xs">{{ relativeTime(s.createdAt) }}</span>
        <div class="flex gap-1">
          <button
            @click="triggerGit(s.id)"
            :disabled="triggering === s.id"
            class="text-xs px-2 py-0.5 border border-warning text-warning hover:text-black hover:bg-warning uppercase tracking-wider disabled:opacity-50"
          >{{ triggering === s.id ? '...' : 'Finalize' }}</button>
          <button
            @click="navigateTo(`/sessions/${s.id}`)"
            class="text-xs px-2 py-0.5 border border-gray-600 text-gray-400 hover:text-white uppercase tracking-wider"
          >View</button>
        </div>
      </div>
    </div>

    <!-- Git jobs (PRs / MRs / webhooks) -->
    <div class="border border-gray-700">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span class="text-xs uppercase tracking-wider text-gray-400">
          {{ forgeMode === 'github' ? 'Pull Requests' : forgeMode === 'gitlab' ? 'Merge Requests' : forgeMode === 'webhook' ? 'Webhook Deliveries' : 'Output Jobs' }}
          <span v-if="gitData">({{ gitData.total }})</span>
        </span>
        <button @click="gitRefresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺ refresh</button>
      </div>

      <div v-if="gitPending" class="px-4 py-6 text-sm text-gray-500">Loading...</div>
      <div v-else-if="gitError" class="px-4 py-4 text-sm text-error">Failed to load git jobs</div>
      <div v-else-if="gitData?.gitJobs.length === 0" class="px-4 py-6 text-sm text-gray-600">
        No git jobs yet. Completed sessions will appear here after finalization.
      </div>
      <div v-else>
        <div class="hidden md:grid grid-cols-[1.5fr_1fr_120px_1fr_100px] gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
          <span>Session</span>
          <span>Forge</span>
          <span>Status</span>
          <span>{{ forgeMode === 'github' ? 'PR' : forgeMode === 'gitlab' ? 'MR' : 'Ref' }}</span>
          <span></span>
        </div>

        <div
          v-for="j in gitData?.gitJobs"
          :key="j.id"
          class="grid grid-cols-[1.5fr_1fr_120px_1fr_100px] gap-4 px-4 py-3 text-sm border-b border-gray-800 last:border-b-0 hover:bg-gray-900"
        >
          <span class="text-gray-300 font-mono text-xs truncate" :title="j.sessionId">
            {{ j.sessionId.slice(0, 16) }}...
          </span>
          <span class="text-gray-400 text-xs uppercase">{{ j.forge }}</span>
          <StatusBadge :status="j.status" />
          <span class="text-xs">
            <a
              v-if="j.prUrl"
              :href="j.prUrl"
              target="_blank"
              class="text-accent hover:underline"
            >{{ j.prNumber ? `#${j.prNumber}` : 'Open' }}</a>
            <span v-else-if="j.status === 'completed'" class="text-success">Done</span>
            <span v-else class="text-gray-500">—</span>
          </span>
          <div class="flex gap-1">
            <button
              @click="navigateTo(`/sessions/${j.sessionId}`)"
              class="text-xs px-2 py-0.5 border border-gray-600 text-gray-400 hover:text-white uppercase tracking-wider"
            >View</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="gitData && gitData.total > gitLimit" class="flex items-center gap-4 mt-4 text-sm">
      <button
        @click="gitOffset = Math.max(0, gitOffset - gitLimit)"
        :disabled="gitOffset === 0"
        class="px-3 py-1 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 uppercase tracking-wider text-xs"
      >← prev</button>
      <span class="text-gray-500 text-xs">
        {{ gitOffset + 1 }}–{{ Math.min(gitOffset + gitLimit, gitData.total) }} of {{ gitData.total }}
      </span>
      <button
        @click="gitOffset += gitLimit"
        :disabled="gitOffset + gitLimit >= (gitData?.total ?? 0)"
        class="px-3 py-1 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 uppercase tracking-wider text-xs"
      >next →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const gitOffset = ref(0)
const gitLimit = 50

// Forge mode from settings
const { data: settings } = await useFetch('/api/settings')
const forgeMode = computed(() => (settings.value?.settings as any)?.GIT_FORGE || 'none')
const createIssues = computed(() => (settings.value?.settings as any)?.GIT_CREATE_ISSUES === 'true')

// Git jobs list
const { data: gitData, pending: gitPending, error: gitError, refresh: gitRefresh } = await useFetch('/api/git', {
  query: computed(() => ({ limit: gitLimit, offset: gitOffset.value })),
  watch: [gitOffset],
})

// Sessions ready for finalize (completed, no git job yet)
const { data: sessionsData, refresh: sessionsRefresh } = await useFetch('/api/sessions', {
  query: { limit: 100 },
})

const readySessions = computed(() => {
  if (!sessionsData.value?.sessions) return []
  const gitSessionIds = new Set((gitData.value?.gitJobs ?? []).map((j: any) => j.sessionId))
  return sessionsData.value.sessions.filter(
    (s: any) => s.status === 'completed' && !gitSessionIds.has(s.id)
  )
})

const triggering = ref<string | null>(null)

async function triggerGit(sessionId: string) {
  triggering.value = sessionId
  try {
    await $fetch(`/api/git/${sessionId}/trigger`, { method: 'POST' })
    sessionsRefresh()
    gitRefresh()
  } catch {
    // error will show on next refresh
  } finally {
    triggering.value = null
  }
}

function targetCount(s: any): string {
  try {
    const arr = JSON.parse(s.targetLocales)
    return `${arr.length} locale${arr.length !== 1 ? 's' : ''}`
  } catch {
    return '?'
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

onMounted(() => {
  const interval = setInterval(() => {
    gitRefresh()
    sessionsRefresh()
  }, 15_000)
  onUnmounted(() => clearInterval(interval))
})
</script>
