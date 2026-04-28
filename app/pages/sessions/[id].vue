<template>
  <div class="min-h-screen bg-black text-white font-mono">
    <!-- Header -->
    <header class="border-b border-gray-700 px-6 pt-6 pb-0">
      <div class="flex items-center gap-4 mb-4">
        <NuxtLink to="/" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">
          ← back
        </NuxtLink>
        <h1 class="text-sm font-bold uppercase tracking-widest">Session Detail</h1>
      </div>

      <div v-if="pending" class="text-sm text-gray-500 pb-4">Loading...</div>
      <div v-else-if="error" class="text-sm text-error pb-4">Session not found</div>
      <div v-else-if="data">
        <!-- Session header -->
        <div class="flex flex-wrap gap-x-8 gap-y-1 mb-4 text-xs">
          <span><span class="text-gray-500">sender:</span> <span class="text-gray-200">{{ data.session.senderId }}</span></span>
          <span><span class="text-gray-500">type:</span> <span class="text-gray-300 uppercase">{{ data.session.sessionType }}</span></span>
          <span><span class="text-gray-500">source:</span> <span class="text-gray-300">{{ data.session.sourceLocale }}</span></span>
          <span><span class="text-gray-500">targets:</span> <span class="text-gray-300">{{ targetLocales.join(', ') }}</span></span>
          <span><span class="text-gray-500">created:</span> <span class="text-gray-300">{{ new Date(data.session.createdAt).toLocaleString() }}</span></span>
          <StatusBadge :status="data.session.status" />
        </div>

        <!-- Sub-tabs -->
        <nav class="flex mt-2">
          <button
            v-for="tab in subTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="px-4 py-2 text-xs uppercase tracking-widest border border-b-0"
            :class="activeTab === tab.id
              ? 'bg-white text-black border-white'
              : 'bg-black text-gray-400 border-gray-700 hover:text-white'"
          >{{ tab.label }}</button>
        </nav>
      </div>
    </header>

    <main v-if="data" class="px-6 py-6">
      <!-- Files tab -->
      <div v-if="activeTab === 'files'">
        <SessionFiles :session-id="id" />
      </div>

      <!-- Events tab -->
      <div v-if="activeTab === 'events'">
        <SessionEvents :session-id="id" />
      </div>

      <!-- Logs tab -->
      <div v-if="activeTab === 'logs'">
        <SessionLogs :session-id="id" />
      </div>

      <!-- Batch tab -->
      <div v-if="activeTab === 'batch'">
        <SessionBatch :session-id="id" :batch="data.batch" />
      </div>

      <!-- Git tab -->
      <div v-if="activeTab === 'git'">
        <SessionGit :session-id="id" :git-job="data.gitJob" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const id = route.params.id as string

const activeTab = ref('files')

const subTabs = [
  { id: 'files',  label: 'Files' },
  { id: 'events', label: 'Events' },
  { id: 'logs',   label: 'Logs' },
  { id: 'batch',  label: 'Batch' },
  { id: 'git',    label: 'Git' },
]

const { data, pending, error, refresh } = await useFetch(`/api/sessions/${id}`)

const targetLocales = computed(() => {
  try { return JSON.parse(data.value?.session.targetLocales ?? '[]') }
  catch { return [] }
})

// SSE for real-time updates
const { connect: connectSSE, disconnect: disconnectSSE } = useSSE(
  computed(() => data.value?.session.senderId ?? null),
  () => refresh(),
)

onMounted(() => connectSSE())
onUnmounted(() => disconnectSSE())

useHead({ title: computed(() => `Session ${id.slice(0, 8)} — auto-i18n`) })
</script>
