/**
 * useErrorBoundary Composable
 * Provides error handling and recovery mechanisms
 */

import { ref } from 'vue'
import { useToast } from './useToast'

export interface ErrorBoundaryOptions {
  fallbackMessage?: string
  showToast?: boolean
  logToConsole?: boolean
  onError?: (error: Error) => void
}

export function useErrorBoundary(options: ErrorBoundaryOptions = {}) {
  const {
    fallbackMessage = 'An unexpected error occurred',
    showToast = true,
    logToConsole = true,
    onError
  } = options

  const toast = useToast()
  const hasError = ref(false)
  const error = ref<Error | null>(null)
  const errorMessage = ref<string>('')

  function captureError(err: unknown, context?: string) {
    hasError.value = true
    
    // Convert to Error object if needed
    if (err instanceof Error) {
      error.value = err
      errorMessage.value = err.message
    } else {
      error.value = new Error(String(err))
      errorMessage.value = String(err)
    }

    // Log to console
    if (logToConsole) {
      console.error(
        context ? `[${context}]` : '[Error]',
        error.value
      )
    }

    // Show toast notification
    if (showToast) {
      toast.error(
        context || 'Error',
        errorMessage.value || fallbackMessage
      )
    }

    // Call custom error handler
    if (onError && error.value) {
      onError(error.value)
    }
  }

  function clearError() {
    hasError.value = false
    error.value = null
    errorMessage.value = ''
  }

  async function tryAsync<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T | null> {
    clearError()
    
    try {
      return await fn()
    } catch (err) {
      captureError(err, context)
      return null
    }
  }

  function trySync<T>(
    fn: () => T,
    context?: string
  ): T | null {
    clearError()
    
    try {
      return fn()
    } catch (err) {
      captureError(err, context)
      return null
    }
  }

  return {
    hasError,
    error,
    errorMessage,
    captureError,
    clearError,
    tryAsync,
    trySync
  }
}
