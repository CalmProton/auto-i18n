<template>
  <div class="flex gap-2">
    <Button
      variant="outline"
      size="sm"
      @click="$emit('toggleExpand')"
    >
      <ChevronDown v-if="isExpanded" class="h-4 w-4 mr-2" />
      <ChevronRight v-else class="h-4 w-4 mr-2" />
      Files
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
      class="bg-red-600 hover:bg-red-700 text-white"
    >
      <Trash2 v-if="!isDeleting" class="h-4 w-4 mr-2" />
      {{ isDeleting ? 'Deleting...' : 'Delete' }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useUploads } from '@/composables'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-vue-next'
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

const { deleteUpload } = useUploads()

const isCreatingBatch = ref(false)
const isDeleting = ref(false)

async function handleCreateBatch() {
  if (!confirm('Create a batch job for this upload?')) return
  
  isCreatingBatch.value = true
  try {
    // TODO: Implement batch creation logic
    // This will create a batch job for translation processing
    emit('refresh')
  } finally {
    isCreatingBatch.value = false
  }
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
