<template>
  <div>
    <div class="border border-gray-700">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span class="text-xs uppercase tracking-wider text-gray-400">
          Translations
          <span v-if="data">({{ data.sessions.length }} sessions)</span>
        </span>
        <button @click="refresh()" class="text-xs text-gray-500 hover:text-white uppercase tracking-wider">↺ refresh</button>
      </div>

      <div v-if="pending" class="px-4 py-6 text-sm text-gray-500">Loading...</div>
      <div v-else-if="error" class="px-4 py-4 text-sm text-error">Failed to load translations</div>
      <div v-else-if="data?.sessions.length === 0" class="px-4 py-6 text-sm text-gray-600">
        No completed sessions with translations yet.
      </div>
      <div v-else>
        <!-- Header row -->
        <div class="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
          <span>Sender / Session</span>
          <span>Locales</span>
          <span>Progress</span>
          <span>Details</span>
        </div>

        <div
          v-for="s in data?.sessions"
          :key="s.id"
          class="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-3 text-sm border-b border-gray-800 last:border-b-0 hover:bg-gray-900"
        >
          <!-- Sender + source -->
          <div class="min-w-0">
            <div class="font-mono text-xs text-gray-300 truncate" :title="s.senderId">
              {{ s.senderId.slice(0, 16) }}{{ s.senderId.length > 16 ? '...' : '' }}
            </div>
            <div class="text-xs text-gray-500 mt-0.5">
              {{ s.sourceLocale }} → {{ s.totalTargets }} targets
            </div>
          </div>

          <!-- Locale bubbles -->
          <div class="flex flex-wrap gap-1 items-start">
            <span
              v-for="l in s.localeProgress.slice(0, 6)"
              :key="l.locale"
              class="inline-flex px-1.5 py-0.5 text-xs border"
              :class="l.done
                ? 'text-success border-success'
                : l.inProgress
                  ? 'text-warning border-warning'
                  : 'text-gray-600 border-gray-700'"
              :title="`${l.locale}: ${l.done ? 'done' : l.inProgress ? 'in progress' : 'pending'}`"
            >{{ l.locale }}</span>
            <span v-if="s.localeProgress.length > 6" class="text-xs text-gray-500 self-center">
              +{{ s.localeProgress.length - 6 }}
            </span>
          </div>

          <!-- Progress bar -->
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-2 bg-gray-800 border border-gray-700">
                <div
                  class="h-full transition-all"
                  :class="s.pct === 100 ? 'bg-success' : 'bg-warning'"
                  :style="{ width: s.pct + '%' }"
                />
              </div>
              <span class="text-xs text-gray-400 w-10 text-right">{{ s.pct }}%</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              @click="navigateTo(`/sessions/${s.id}`)"
              class="text-xs px-2 py-0.5 border border-gray-600 text-gray-400 hover:text-white hover:border-white uppercase tracking-wider"
            >View</button>
            <span class="text-xs text-gray-500">{{ s.completed }}/{{ s.total }}</span>
          </div>
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

const { data, pending, error, refresh } = await useFetch('/api/sessions', {
  query: computed(() => ({ limit, offset: offset.value })),
  watch: [offset],
  transform: (raw: any) => {
    if (!raw?.sessions) return raw

    // Only show sessions with completed or processing status
    const relevant = raw.sessions.filter(
      (s: any) => s.status === 'completed' || s.status === 'processing'
    )

    const enriched = relevant.map((s: any) => {
      let targetLocales: string[] = []
      try { targetLocales = JSON.parse(s.targetLocales) } catch {}

      // Simulate progress for now — in production this would come from files API
      // For demo: completed sessions = 100%, processing = partial based on hash
      const hash = s.id.charCodeAt(0) + s.id.charCodeAt(s.id.length - 1)
      const baseProgress = s.status === 'completed' ? 100 : Math.max(5, (hash % 85) + 10)

      const localeProgress = targetLocales.map((locale: string, i: number) => ({
        locale,
        done: s.status === 'completed' || i < Math.ceil(targetLocales.length * baseProgress / 100),
        inProgress: s.status === 'processing' && i === Math.ceil(targetLocales.length * baseProgress / 100),
      }))

      return {
        ...s,
        totalTargets: targetLocales.length,
        localeProgress,
        pct: baseProgress,
        completed: s.status === 'completed' ? targetLocales.length : Math.floor(targetLocales.length * baseProgress / 100),
        total: targetLocales.length,
      }
    })

    return { sessions: enriched, total: enriched.length, limit: raw.limit, offset: raw.offset }
  },
})

onMounted(() => {
  const interval = setInterval(() => refresh(), 15_000)
  onUnmounted(() => clearInterval(interval))
})
</script>
