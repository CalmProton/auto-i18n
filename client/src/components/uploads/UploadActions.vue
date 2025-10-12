<template>
  <div class="flex gap-2">
    <Button
      variant="ghost"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      <Icon :icon="isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'" :size="20" class="mr-1" />
      Files
    </Button>
    
    <Button
      v-if="!upload.hasTranslations"
      variant="default"
      size="sm"
      @click="handleTriggerTranslation"
      :disabled="isTriggering"
    >
      <Icon v-if="!isTriggering" icon="mdi:rocket-launch" :size="18" class="mr-1" />
      {{ isTriggering ? 'Starting...' : 'Trigger Translation' }}
    </Button>
    
    <Button
      v-if="upload.status === 'completed'"
      variant="outline"
      size="sm"
      @click="handleCreatePR"
    >
      <Icon icon="mdi:source-pull" :size="18" class="mr-1" />
      Create PR
    </Button>
    
    <Button
      variant="outline"
      size="sm"
      @click="handleCreateBatch"
      :disabled="isCreatingBatch"
    >
      <Icon v-if="!isCreatingBatch" icon="mdi:package-variant-closed" :size="18" class="mr-1" />
      {{ isCreatingBatch ? 'Creating...' : 'Create Batch' }}
    </Button>
    
    <Button
      variant="destructive"
      size="sm"
      @click="handleDelete"
      :disabled="isDeleting"
    >
      <Icon v-if="!isDeleting" icon="mdi:delete" :size="18" class="mr-1" />
      {{ isDeleting ? 'Deleting...' : 'Delete' }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useUploads, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
import Icon from '../Icon.vue'
import type { Upload } from '@/types/api'

const props = defineProps<{
  upload: Upload
  isExpanded: boolean
}>()

const emit = defineEmits<{
  toggleExpand: []
  refresh: []
}>()

const { triggerTranslation, deleteUpload } = useUploads()
const { success } = useToast()

const isTriggering = ref(false)
const isCreatingBatch = ref(false)
const isDeleting = ref(false)

async function handleTriggerTranslation() {
  if (!confirm('Trigger translation for all target locales?')) return
  
  isTriggering.value = true
  try {
    const result = await triggerTranslation(props.upload.senderId, {})
    if (result) {
      emit('refresh')
    }
  } finally {
    isTriggering.value = false
  }
}

async function handleCreateBatch() {
  if (!confirm('Create a batch job for this upload?')) return
  
  isCreatingBatch.value = true
  try {
    // Trigger with batch mode via options
    const result = await triggerTranslation(props.upload.senderId, {})
    if (result) {
      emit('refresh')
    }
  } finally {
    isCreatingBatch.value = false
  }
}

async function handleCreatePR() {
  // Navigate to GitHub tab or show PR dialog
  success('GitHub Integration', 'This will open the GitHub PR creation dialog')
}

async function handleDelete() {
  if (!confirm(`Delete upload session ${props.upload.senderId}? This action cannot be undone.`)) return
  
  isDeleting.value = true
  try {
    const result = await deleteUpload(props.upload.senderId)
    if (result) {
      emit('refresh')
    }
  } finally {
    isDeleting.value = false
  }
}
</script>
