<template>
  <div class="flex items-center justify-between pt-4 border-t">
    <div class="text-sm text-muted-foreground">
      <p v-if="disabled && selectedLocales.length === 0">
        Please select at least one locale
      </p>
      <p v-else-if="disabled && !title.trim()">
        Please enter a PR title
      </p>
      <p v-else-if="disabled && !description.trim()">
        Please enter a PR description
      </p>
      <p v-else class="text-green-600">
        ✓ Ready to create pull request
      </p>
    </div>

    <Button
      @click="handleCreate"
      :disabled="disabled || creating"
      size="lg"
    >
      <span v-if="creating">Creating PR...</span>
      <span v-else>
        <span class="mr-2">🚀</span>
        Create Pull Request
      </span>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { GitHubSession } from '@/types/api'
import { Button } from '@/components/ui/button'

defineProps<{
  session: GitHubSession
  selectedLocales: string[]
  title: string
  description: string
  disabled: boolean
}>()

const emit = defineEmits<{
  create: []
}>()

const creating = ref(false)

async function handleCreate() {
  if (creating.value) return
  
  creating.value = true
  try {
    emit('create')
  } finally {
    // Reset after a delay to prevent double-clicks
    setTimeout(() => {
      creating.value = false
    }, 2000)
  }
}
</script>
