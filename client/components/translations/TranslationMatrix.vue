<template>
  <div class="space-y-2">
    <h3 class="text-sm font-semibold">Translation Matrix</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-border">
            <th class="p-2 text-left font-medium">Locale</th>
            <th class="p-2 text-center font-medium">Content</th>
            <th class="p-2 text-center font-medium">Global</th>
            <th class="p-2 text-center font-medium">Page</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="locale in sortedLocales"
            :key="locale"
            class="border-b border-border hover:bg-muted/50"
          >
            <td class="p-2 font-medium">
              <span v-if="locale === sourceLocale" class="text-blue-600">
                {{ locale }} (source)
              </span>
              <span v-else>{{ locale }}</span>
            </td>
            <td class="p-2 text-center">
              <FileStatusBadge
                :count="matrix[locale]?.content.count ?? 0"
                :expected="matrix[locale]?.content.expected ?? 0"
              />
            </td>
            <td class="p-2 text-center">
              <FileStatusBadge
                :count="matrix[locale]?.global.count ?? 0"
                :expected="matrix[locale]?.global.expected ?? 0"
              />
            </td>
            <td class="p-2 text-center">
              <FileStatusBadge
                :count="matrix[locale]?.page.count ?? 0"
                :expected="matrix[locale]?.page.expected ?? 0"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TranslationSession } from '@/types/api'
import FileStatusBadge from './FileStatusBadge.vue'

const props = defineProps<{
  matrix: TranslationSession['matrix']
  sourceLocale: string
}>()

const sortedLocales = computed(() => {
  const locales = Object.keys(props.matrix)
  
  // Sort with source locale first, then alphabetically
  return locales.sort((a, b) => {
    if (a === props.sourceLocale) return -1
    if (b === props.sourceLocale) return 1
    return a.localeCompare(b)
  })
})
</script>
