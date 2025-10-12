<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="close"
  >
    <div class="bg-background border rounded-lg shadow-lg max-w-md w-full mx-4 p-6">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <Icon icon="mdi:keyboard" :size="24" color="3b82f6" />
          <h2 class="text-xl font-bold">Keyboard Shortcuts</h2>
        </div>
        <Button @click="close" variant="ghost" size="sm">
          <Icon icon="mdi:close" :size="20" />
        </Button>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between py-2 border-b">
          <span class="text-sm">Go to Uploads tab</span>
          <kbd class="px-2 py-1 text-xs font-mono bg-muted rounded">Alt + 1</kbd>
        </div>
        <div class="flex items-center justify-between py-2 border-b">
          <span class="text-sm">Go to Batches tab</span>
          <kbd class="px-2 py-1 text-xs font-mono bg-muted rounded">Alt + 2</kbd>
        </div>
        <div class="flex items-center justify-between py-2 border-b">
          <span class="text-sm">Go to Translations tab</span>
          <kbd class="px-2 py-1 text-xs font-mono bg-muted rounded">Alt + 3</kbd>
        </div>
        <div class="flex items-center justify-between py-2 border-b">
          <span class="text-sm">Go to GitHub tab</span>
          <kbd class="px-2 py-1 text-xs font-mono bg-muted rounded">Alt + 4</kbd>
        </div>
        <div class="flex items-center justify-between py-2 border-b">
          <span class="text-sm">Show this help</span>
          <kbd class="px-2 py-1 text-xs font-mono bg-muted rounded">?</kbd>
        </div>
      </div>

      <div class="mt-6 text-xs text-muted-foreground text-center">
        Shortcuts work when not typing in input fields
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Button } from '@/components/ui/button'
import Icon from './Icon.vue'

const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function toggle() {
  isOpen.value = !isOpen.value
}

function handleKeyPress(event: KeyboardEvent) {
  // Open help with '?' key (shift + /)
  if (event.key === '?' && !isOpen.value) {
    const target = event.target as HTMLElement
    // Don't trigger if typing in inputs
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }
    event.preventDefault()
    open()
  }
  
  // Close with Escape
  if (event.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyPress)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyPress)
})

defineExpose({ open, close, toggle })
</script>
