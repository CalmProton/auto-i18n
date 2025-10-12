<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <CardTitle class="flex items-center gap-2">
            <span class="font-mono text-sm">{{ session.senderId }}</span>
            <CompletionBadge :percentage="session.summary.percentage" />
          </CardTitle>
          <CardDescription class="mt-2">
            <div class="space-y-1">
              <div v-if="session.repositoryName" class="font-semibold">
                {{ session.repositoryName }}
              </div>
              <div class="text-xs">
                {{ session.sourceLocale }} → {{ session.targetLocales.length }} locales
                • Last updated {{ formatDate(session.lastUpdated) }}
              </div>
            </div>
          </CardDescription>
        </div>
        
        <TranslationActions
          :session="session"
          :is-expanded="isExpanded"
          @toggle-expand="isExpanded = !isExpanded"
          @refresh="$emit('refresh')"
        />
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Completion Summary -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="text-center">
          <div class="text-2xl font-bold text-green-600">
            {{ session.summary.completed }}
          </div>
          <div class="text-xs text-muted-foreground">Completed</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-orange-600">
            {{ session.summary.missing }}
          </div>
          <div class="text-xs text-muted-foreground">Missing</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold">
            {{ session.summary.total }}
          </div>
          <div class="text-xs text-muted-foreground">Total Files</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-blue-600">
            {{ session.summary.percentage }}%
          </div>
          <div class="text-xs text-muted-foreground">Complete</div>
        </div>
      </div>

      <!-- Progress Bar -->
      <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          class="bg-green-600 h-2 rounded-full transition-all"
          :style="{ width: `${session.summary.percentage}%` }"
        />
      </div>

      <!-- Translation Matrix (expandable) -->
      <div v-if="isExpanded" class="pt-4 border-t">
        <TranslationMatrix :matrix="session.matrix" :source-locale="session.sourceLocale" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { TranslationSession } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import CompletionBadge from './CompletionBadge.vue'
import TranslationActions from './TranslationActions.vue'
import TranslationMatrix from './TranslationMatrix.vue'

const props = defineProps<{
  session: TranslationSession
}>()

defineEmits<{
  refresh: []
}>()

const isExpanded = ref(false)

// Computed values are now available from session.summary

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  
  return date.toLocaleDateString()
}
</script>
