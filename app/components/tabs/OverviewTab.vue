<template>
  <div>
    <div v-if="pending" class="text-gray-500 text-sm">Loading...</div>
    <div v-else-if="error" class="text-error text-sm">Failed to load overview</div>
    <div v-else-if="data">
      <!-- Stats grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-px border border-gray-700 mb-6">
        <div v-for="stat in stats" :key="stat.label" class="bg-gray-900 p-4 border border-gray-800">
          <div class="text-2xl font-bold" :class="stat.color">{{ stat.value }}</div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mt-1">{{ stat.label }}</div>
        </div>
      </div>

      <!-- Queue state -->
      <div class="border border-gray-700 mb-6">
        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
          Queue
        </div>
        <div class="flex gap-6 px-4 py-3 text-sm">
          <span><span class="text-warning">{{ data.jobs.pending }}</span> <span class="text-gray-500">pending</span></span>
          <span><span class="text-accent">{{ data.jobs.running }}</span> <span class="text-gray-500">running</span></span>
          <span><span class="text-error">{{ data.jobs.failed }}</span> <span class="text-gray-500">failed</span></span>
        </div>
      </div>

      <!-- Recent sessions -->
      <div class="border border-gray-700">
        <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
          <span class="text-xs uppercase tracking-wider text-gray-400">Recent Sessions</span>
          <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺ refresh</button>
        </div>
        <div v-if="data.recentSessions.length === 0" class="px-4 py-6 text-sm text-gray-600">
          No sessions yet.
        </div>
        <div v-else>
          <SessionRow
            v-for="s in data.recentSessions"
            :key="s.id"
            :session="s"
            class="border-b border-gray-800 last:border-b-0"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { data, pending, error, refresh } = await useFetch('/api/overview')

const stats = computed(() => {
  if (!data.value) return []
  const s = data.value.sessionsByStatus as Record<string, number>
  return [
    { label: 'Total', value: data.value.totalSessions, color: 'text-white' },
    { label: 'Processing', value: s.processing ?? 0, color: 'text-warning' },
    { label: 'Completed', value: s.completed ?? 0, color: 'text-success' },
    { label: 'Failed', value: s.failed ?? 0, color: 'text-error' },
  ]
})

// Auto-refresh every 15s
onMounted(() => {
  const interval = setInterval(() => refresh(), 15_000)
  onUnmounted(() => clearInterval(interval))
})
</script>
