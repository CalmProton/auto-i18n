<template>
  <div class="border border-gray-700">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
      <span class="text-xs uppercase tracking-wider text-gray-400">Files ({{ data?.total ?? 0 }})</span>
      <div class="flex gap-3 text-xs">
        <button
          v-for="ft in fileTypes"
          :key="ft"
          @click="filter = ft"
          class="uppercase tracking-wider"
          :class="filter === ft ? 'text-white' : 'text-gray-500 hover:text-gray-300'"
        >{{ ft }}</button>
      </div>
    </div>

    <div v-if="pending" class="px-4 py-4 text-sm text-gray-500">Loading...</div>
    <div v-else-if="!data?.files.length" class="px-4 py-6 text-sm text-gray-600">No files.</div>
    <div v-else>
      <div
        v-for="file in data.files"
        :key="file.id"
        class="flex items-center gap-4 px-4 py-2 border-b border-gray-800 last:border-0 text-xs hover:bg-gray-900"
      >
        <span class="text-gray-500 uppercase w-20 shrink-0">{{ file.fileType }}</span>
        <span class="text-gray-400 uppercase w-16 shrink-0">{{ file.locale }}</span>
        <span class="text-gray-400 uppercase w-16 shrink-0">{{ file.format }}</span>
        <span class="text-gray-300 truncate flex-1 font-mono">{{ file.filePath }}</span>
        <a
          :href="`/api/files/${sessionId}/${file.id}`"
          target="_blank"
          class="text-gray-500 hover:text-accent uppercase tracking-wider shrink-0"
        >↗ raw</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ sessionId: string }>()

const filter = ref('all')
const fileTypes = ['all', 'upload', 'translation', 'delta', 'original']

interface FileRow {
  id: string; fileType: string; locale: string; format: string; filePath: string; contentType: string
}
const { data, pending } = await useFetch<{ files: FileRow[]; total: number }>(
  computed(() => `/api/files/${props.sessionId}`),
  { query: computed(() => filter.value !== 'all' ? { fileType: filter.value } : {}), watch: [filter] },
)
</script>
