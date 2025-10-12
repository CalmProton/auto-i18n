<template>
  <div class="flex gap-2 flex-wrap">
    <Button
      variant="ghost"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      <Icon :icon="isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'" :size="20" class="mr-1" />
      Matrix
    </Button>
    
    <Button
      v-if="canCreatePR"
      variant="default"
      size="sm"
      @click="handleCreatePR"
    >
      <Icon icon="mdi:source-pull" :size="18" class="mr-1" />
      Create PR
    </Button>
    
    <Button
      variant="outline"
      size="sm"
      @click="handleExport"
    >
      <Icon icon="mdi:file-export" :size="18" class="mr-1" />
      Export
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslations, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
import Icon from '../Icon.vue'
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
