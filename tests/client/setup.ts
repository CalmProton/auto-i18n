/**
 * Vitest Setup File
 * Global test configuration for Vue components
 */

import { config } from '@vue/test-utils'
import { vi } from 'vitest'

// Mock window.localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock fetch globally
global.fetch = vi.fn()

// Configure Vue Test Utils
config.global.mocks = {
  $t: (key: string) => key, // Mock i18n if needed
}

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
})
