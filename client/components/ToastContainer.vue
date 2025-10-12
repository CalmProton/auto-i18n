<template>
  <div class="fixed top-4 right-4 z-50 space-y-2 max-w-md">
    <TransitionGroup name="toast">
      <Alert
        v-for="toast in toasts"
        :key="toast.id"
        :variant="getVariant(toast.type)"
        class="shadow-lg"
      >
        <component :is="getIcon(toast.type)" class="h-4 w-4" />
        <AlertDescription>
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1">
              <div class="font-semibold">{{ toast.title }}</div>
              <div v-if="toast.message" class="text-sm mt-1">{{ toast.message }}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6"
              @click="removeToast(toast.id)"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '@/composables'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-vue-next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ToastType } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function getVariant(type: ToastType): 'default' | 'destructive' {
  return type === 'error' ? 'destructive' : 'default'
}

function getIcon(type: ToastType) {
  switch (type) {
    case 'success':
      return CheckCircle
    case 'error':
      return AlertCircle
    case 'info':
      return Info
    default:
      return Info
  }
}

function removeToast(id: string) {
  dismiss(id)
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
