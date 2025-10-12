/**
 * useToast Composable
 * Simple toast notification system
 */

import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

const toasts = ref<Toast[]>([])
let idCounter = 0

export function useToast() {
  /**
   * Show a toast notification
   */
  function show(
    type: ToastType,
    title: string,
    message?: string,
    duration: number = 5000
  ): string {
    const id = `toast-${++idCounter}`
    const toast: Toast = {
      id,
      type,
      title,
      message,
      duration,
    }

    toasts.value.push(toast)

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        dismiss(id)
      }, duration)
    }

    return id
  }

  /**
   * Dismiss a toast by ID
   */
  function dismiss(id: string): void {
    const index = toasts.value.findIndex((t) => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  /**
   * Dismiss all toasts
   */
  function dismissAll(): void {
    toasts.value = []
  }

  /**
   * Convenience methods for different toast types
   */
  function success(title: string, message?: string, duration?: number): string {
    return show('success', title, message, duration)
  }

  function error(title: string, message?: string, duration?: number): string {
    return show('error', title, message, duration)
  }

  function warning(title: string, message?: string, duration?: number): string {
    return show('warning', title, message, duration)
  }

  function info(title: string, message?: string, duration?: number): string {
    return show('info', title, message, duration)
  }

  return {
    toasts,
    show,
    dismiss,
    dismissAll,
    success,
    error,
    warning,
    info,
  }
}
