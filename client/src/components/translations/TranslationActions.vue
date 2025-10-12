<template>
  <div class="flex gap-2 flex-wrap">
    <Button
      variant="ghost"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      {{ isExpanded ? '▼' : '▶' }} Matrix
    </Button>
    
    <Button
      v-if="canCreatePR"
      variant="default"
      size="sm"
      @click="handleCreatePR"
    >
      🔀 Create PR
    </Button>
    
    <Button
      variant="outline"
      size="sm"
      @click="handleExport"
    >
      📦 Export
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslations, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
import type { TranslationSession } from '@/types/api'

const props = defineProps<{
  session: TranslationSession
  isExpanded: boolean
}>()

const emit = defineEmits<{
  toggleExpand: []
  refresh: []
}>()

const { isSessionComplete } = useTranslations()
const { success } = useToast()

const canCreatePR = computed(() => {
  return isSessionComplete(props.session)
})

function handleCreatePR() {
  success('GitHub Integration', 'This will navigate to the GitHub tab for PR creation')
  // TODO: Navigate to GitHub tab with this session pre-selected
}

function handleExport() {
  success('Export', 'Translation export feature coming soon')
  // TODO: Implement export functionality
}
</script>
