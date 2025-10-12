/**
 * useRefreshInterval Composable
 * Manages auto-refresh intervals with pause/resume capability
 */

import { ref, onMounted, onUnmounted } from 'vue'

export interface RefreshOptions {
  interval?: number // milliseconds
  immediate?: boolean // refresh immediately on mount
  pauseOnError?: boolean // pause refresh if callback throws error
}

export function useRefreshInterval(
  callback: () => void | Promise<void>,
  options: RefreshOptions = {}
) {
  const {
    interval = 30000, // 30 seconds default
    immediate = true,
    pauseOnError = false
  } = options

  const isActive = ref(false)
  const isPaused = ref(false)
  const lastRefresh = ref<Date | null>(null)
  const nextRefresh = ref<Date | null>(null)
  const errorCount = ref(0)

  let intervalId: number | null = null

  async function refresh() {
    if (isPaused.value) return

    try {
      await callback()
      lastRefresh.value = new Date()
      errorCount.value = 0
    } catch (error) {
      errorCount.value++
      console.error('Refresh error:', error)
      
      if (pauseOnError) {
        pause()
      }
    }
  }

  function start() {
    if (isActive.value) return

    isActive.value = true
    isPaused.value = false

    // Immediate refresh if requested
    if (immediate) {
      refresh()
    }

    // Set up interval
    intervalId = window.setInterval(() => {
      nextRefresh.value = new Date(Date.now() + interval)
      refresh()
    }, interval)

    // Set next refresh time
    nextRefresh.value = new Date(Date.now() + interval)
  }

  function pause() {
    isPaused.value = true
    nextRefresh.value = null
  }

  function resume() {
    if (!isActive.value) {
      start()
      return
    }

    isPaused.value = false
    refresh()
    nextRefresh.value = new Date(Date.now() + interval)
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    isActive.value = false
    isPaused.value = false
    nextRefresh.value = null
  }

  function reset() {
    stop()
    lastRefresh.value = null
    errorCount.value = 0
  }

  // Auto-start on mount
  onMounted(() => {
    start()
  })

  // Clean up on unmount
  onUnmounted(() => {
    stop()
  })

  return {
    isActive,
    isPaused,
    lastRefresh,
    nextRefresh,
    errorCount,
    start,
    pause,
    resume,
    stop,
    reset,
    refresh
  }
}
