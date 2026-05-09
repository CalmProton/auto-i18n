<template>
  <div>
    <div class="border border-gray-700">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span class="text-xs uppercase tracking-wider text-gray-400">
          Batches <span v-if="data">({{ data.total }})</span>
        </span>
        <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺ refresh</button>
      </div>

      <div v-if="pending" class="px-4 py-6 text-sm text-gray-500">Loading...</div>
      <div v-else-if="error" class="px-4 py-4 text-sm text-error">Failed to load batches</div>
      <div v-else-if="!(data?.batches as any)?.length" class="px-4 py-6 text-sm text-gray-600">
        No batch jobs yet. Create a translation session to populate batches.
      </div>
      <div v-else>
        <!-- Header row -->
        <div class="hidden md:grid grid-cols-[1fr_100px_120px_100px_100px_100px_80px] gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
          <span>Session</span>
          <span>Provider</span>
          <span>Status</span>
          <span>Requests</span>
          <span>Completed</span>
          <span>Failed</span>
          <span></span>
        </div>

        <div
          v-for="b in data?.batches ?? []"
          :key="b.id"
          class="grid grid-cols-[1fr_100px_120px_100px_100px_100px_80px] gap-4 px-4 py-3 text-sm border-b border-gray-800 last:border-b-0 hover:bg-gray-900"
        >
          <span class="text-gray-300 font-mono text-xs truncate" :title="b.sessionId">
            {{ b.sessionId.slice(0, 8) }}...
          </span>
          <span class="text-gray-400 text-xs uppercase">{{ b.provider }}</span>
          <StatusBadge :status="b.status" />
          <span class="text-gray-300 text-xs">{{ b.totalRequests }}</span>
          <span class="text-success text-xs">{{ b.completed }}</span>
          <span class="text-error text-xs">{{ b.failed }}</span>
          <button
            v-if="b.status === 'pending'"
            @click="submitBatch(b.id, b.sessionId)"
            :disabled="submitting === b.id"
            class="text-xs px-2 py-0.5 border border-gray-600 text-gray-300 hover:text-white hover:border-white uppercase tracking-wider disabled:opacity-50"
          >{{ submitting === b.id ? '...' : 'Submit' }}</button>
          <button
            v-else-if="b.status === 'completed'"
            @click="navigateTo(`/sessions/${b.sessionId}`)"
            class="text-xs px-2 py-0.5 border border-gray-600 text-gray-400 hover:text-white hover:border-white uppercase tracking-wider"
          >View</button>
          <span v-else class="text-xs text-gray-600">—</span>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="data && data.total > limit" class="flex items-center gap-4 mt-4 text-sm">
      <button
        @click="offset = Math.max(0, offset - limit)"
        :disabled="offset === 0"
        class="px-3 py-1 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 uppercase tracking-wider text-xs"
      >← prev</button>
      <span class="text-gray-500 text-xs">
        {{ offset + 1 }}–{{ Math.min(offset + limit, data.total) }} of {{ data.total }}
      </span>
      <button
        @click="offset += limit"
        :disabled="offset + limit >= (data?.total ?? 0)"
        class="px-3 py-1 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 uppercase tracking-wider text-xs"
      >next →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const offset = ref(0)
const limit = 50

const { data, pending, error, refresh } = await useFetch('/api/batch', {
  query: computed(() => ({ limit, offset: offset.value })),
  watch: [offset],
})

const submitting = ref<string | null>(null)

async function submitBatch(batchId: string, sessionId: string) {
  submitting.value = batchId
  try {
    await $fetch(`/api/batch/${sessionId}/submit`, { method: 'POST' })
    refresh()
  } catch {
    // error will show on next refresh
  } finally {
    submitting.value = null
  }
}

onMounted(() => {
  const interval = setInterval(() => refresh(), 15_000)
  onUnmounted(() => clearInterval(interval))
})
</script>
