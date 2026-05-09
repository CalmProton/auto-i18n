<template>
  <div class="border border-gray-700">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
      <span class="text-xs uppercase tracking-wider text-gray-400">Pipeline Events</span>
      <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺</button>
    </div>

    <div v-if="pending" class="px-4 py-4 text-sm text-gray-500">Loading...</div>
    <div v-else-if="!data?.events.length" class="px-4 py-6 text-sm text-gray-600">No events yet.</div>
    <div v-else>
      <div
        v-for="ev in data.events"
        :key="ev.id"
        class="flex items-start gap-4 px-4 py-2 border-b border-gray-800 last:border-0 text-xs"
      >
        <span class="text-gray-500 w-28 shrink-0">{{ new Date(ev.createdAt).toLocaleTimeString() }}</span>
        <span class="font-bold w-32 shrink-0 uppercase tracking-wider" :class="stepColor(ev.status)">{{ ev.step }}</span>
        <span class="uppercase w-20 shrink-0" :class="stepColor(ev.status)">{{ ev.status }}</span>
        <span v-if="ev.durationMs" class="text-gray-500 w-20 shrink-0">{{ ev.durationMs }}ms</span>
        <span v-if="ev.error" class="text-error truncate flex-1">{{ ev.error }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()

interface EventRow {
  id: string; step: string; status: string
  durationMs?: number | null; error?: string | null; createdAt: string
}
const { data, pending, refresh } = await useFetch<{ events: EventRow[] }>(
  computed(() => `/api/pipeline/${props.sessionId}/events`),
)

function stepColor(status: string) {
  if (status === 'completed') return 'text-success'
  if (status === 'failed') return 'text-error'
  return 'text-warning'
}
</script>
