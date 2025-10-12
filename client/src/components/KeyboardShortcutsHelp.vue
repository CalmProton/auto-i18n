<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Keyboard class="h-5 w-5 text-primary" />
          Keyboard Shortcuts
        </DialogTitle>
        <DialogDescription>
          Quickly navigate through the dashboard using these keyboard shortcuts
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div class="flex items-center justify-between py-2">
          <span class="text-sm">Go to Uploads tab</span>
          <div class="flex gap-1">
            <Kbd>Alt</Kbd>
            <span class="text-muted-foreground">+</span>
            <Kbd>1</Kbd>
          </div>
        </div>
        <Separator />
        <div class="flex items-center justify-between py-2">
          <span class="text-sm">Go to Batches tab</span>
          <div class="flex gap-1">
            <Kbd>Alt</Kbd>
            <span class="text-muted-foreground">+</span>
            <Kbd>2</Kbd>
          </div>
        </div>
        <Separator />
        <div class="flex items-center justify-between py-2">
          <span class="text-sm">Go to Translations tab</span>
          <div class="flex gap-1">
            <Kbd>Alt</Kbd>
            <span class="text-muted-foreground">+</span>
            <Kbd>3</Kbd>
          </div>
        </div>
        <Separator />
        <div class="flex items-center justify-between py-2">
          <span class="text-sm">Go to GitHub tab</span>
          <div class="flex gap-1">
            <Kbd>Alt</Kbd>
            <span class="text-muted-foreground">+</span>
            <Kbd>4</Kbd>
          </div>
        </div>
        <Separator />
        <div class="flex items-center justify-between py-2">
          <span class="text-sm">Show this help</span>
          <Kbd>?</Kbd>
        </div>
      </div>

      <DialogFooter class="sm:justify-start">
        <p class="text-xs text-muted-foreground">
          Shortcuts work when not typing in input fields
        </p>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Keyboard } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'

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
