<template>
  <div class="border border-gray-700">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
      <span class="text-xs uppercase tracking-wider text-gray-400">API Logs ({{ data?.logs.length ?? 0 }})</span>
      <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺</button>
    </div>

    <div v-if="pending" class="px-4 py-4 text-sm text-gray-500">Loading...</div>
    <div v-else-if="!data?.logs.length" class="px-4 py-6 text-sm text-gray-600">No API logs yet.</div>
    <div v-else>
      <div
        v-for="log in data.logs"
        :key="log.id"
        class="flex items-center gap-4 px-4 py-2 border-b border-gray-800 last:border-0 text-xs"
      >
        <span class="text-gray-500 w-28 shrink-0">{{ new Date(log.createdAt).toLocaleTimeString() }}</span>
        <span class="text-gray-300 uppercase w-24 shrink-0">{{ log.provider }}</span>
        <span class="text-gray-400 truncate w-40 shrink-0" :title="log.model">{{ log.model }}</span>
        <span
          class="w-12 shrink-0 text-center"
          :class="log.statusCode && log.statusCode < 400 ? 'text-success' : 'text-error'"
        >{{ log.statusCode ?? '—' }}</span>
        <span class="text-gray-500 w-20 shrink-0">{{ log.durationMs != null ? `${log.durationMs}ms` : '—' }}</span>
        <span v-if="log.isMock" class="text-warning uppercase text-xs shrink-0">mock</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()

interface LogRow {
  id: string; provider: string; model: string
  statusCode?: number | null; durationMs?: number | null
  isMock: number; createdAt: string
}
const { data, pending, refresh } = await useFetch<{ logs: LogRow[] }>(
  computed(() => `/api/pipeline/${props.sessionId}/logs`),
)
</script>
