<template>
  <div>
    <!-- Table -->
    <div class="border border-gray-700">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span class="text-xs uppercase tracking-wider text-gray-400">
          Sessions <span v-if="data">({{ data.total }})</span>
        </span>
        <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺ refresh</button>
      </div>

      <div v-if="pending" class="px-4 py-6 text-sm text-gray-500">Loading...</div>
      <div v-else-if="error" class="px-4 py-4 text-sm text-error">Failed to load sessions</div>
      <div v-else-if="data?.sessions.length === 0" class="px-4 py-6 text-sm text-gray-600">
        No sessions yet.
      </div>
      <div v-else>
        <!-- Header row -->
        <div class="hidden md:grid grid-cols-[1fr_120px_160px_160px_80px] gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
          <span>Sender ID</span>
          <span>Type</span>
          <span>Locales</span>
          <span>Created</span>
          <span>Status</span>
        </div>
        <SessionRow
          v-for="s in data?.sessions"
          :key="s.id"
          :session="s"
          class="border-b border-gray-800 last:border-b-0 cursor-pointer hover:bg-gray-900"
          @click="navigateTo(`/sessions/${s.id}`)"
        />
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

const { data, pending, error, refresh } = await useFetch('/api/sessions', {
  query: computed(() => ({ limit, offset: offset.value })),
  watch: [offset],
})
</script>
