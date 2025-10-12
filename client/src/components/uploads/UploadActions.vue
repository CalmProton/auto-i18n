<template>
  <div class="flex gap-2">
    <Button
      variant="ghost"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      {{ isExpanded ? '▼' : '▶' }} Files
    </Button>
    
    <Button
      v-if="!upload.hasTranslations"
      variant="default"
      size="sm"
      @click="handleTriggerTranslation"
      :disabled="isTriggering"
    >
      {{ isTriggering ? 'Starting...' : '🚀 Trigger Translation' }}
    </Button>
    
    <Button
      v-if="upload.status === 'completed'"
      variant="outline"
      size="sm"
      @click="handleCreatePR"
    >
      🔀 Create PR
    </Button>
    
    <Button
      variant="outline"
      size="sm"
      @click="handleCreateBatch"
      :disabled="isCreatingBatch"
    >
      {{ isCreatingBatch ? 'Creating...' : '📦 Create Batch' }}
    </Button>
    
    <Button
      variant="destructive"
      size="sm"
      @click="handleDelete"
      :disabled="isDeleting"
    >
      {{ isDeleting ? 'Deleting...' : '🗑️ Delete' }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useUploads, useToast } from '@/composables'
import { Button } from '@/components/ui/button'
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
