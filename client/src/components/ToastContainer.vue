<template>
  <div class="fixed top-4 right-4 z-50 space-y-2 max-w-md">
    <TransitionGroup name="toast">
      <Alert
        v-for="toast in toasts"
        :key="toast.id"
        :variant="getVariant(toast.type)"
        class="shadow-lg"
      >
        <AlertDescription>
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1">
              <div class="font-semibold">{{ toast.title }}</div>
              <div v-if="toast.message" class="text-sm mt-1">{{ toast.message }}</div>
            </div>
            <button
              @click="removeToast(toast.id)"
              class="text-current opacity-70 hover:opacity-100 transition-opacity flex items-center"
            >
              <Icon icon="mdi:close" :size="18" />
            </button>
          </div>
        </AlertDescription>
      </Alert>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '@/composables'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Icon from './Icon.vue'
import type { ToastType } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function getVariant(type: ToastType): 'default' | 'destructive' {
  return type === 'error' ? 'destructive' : 'default'
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
