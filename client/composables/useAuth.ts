/**
 * useAuth Composable
 * Handles authentication state and operations
 */

import { ref, computed } from 'vue'
import { api, getAccessKey, setAccessKey, clearAccessKey } from '../lib/api-client'
import type { AuthCheckResponse, AuthValidateResponse } from '../types/api'

const accessKey = ref<string | null>(getAccessKey())
const authRequired = ref<boolean>(false)
const isChecking = ref<boolean>(false)
const isValidating = ref<boolean>(false)
const error = ref<string | null>(null)

export function useAuth() {
  const isAuthenticated = computed(() => {
    if (!authRequired.value) return true
    return !!accessKey.value
  })

  /**
   * Check if authentication is required
   */
  async function checkAuthRequired(): Promise<boolean> {
    isChecking.value = true
    error.value = null

    try {
      const response = await api.get<AuthCheckResponse>('/api/auth/check')
      authRequired.value = response.authRequired
      return response.authRequired
    } catch (err) {
      console.error('Failed to check auth requirement:', err)
      error.value = err instanceof Error ? err.message : 'Failed to check authentication'
      return false
    } finally {
      isChecking.value = false
    }
  }

  /**
   * Validate the access key
   */
  async function validateAccessKey(key: string): Promise<boolean> {
    isValidating.value = true
    error.value = null

    try {
      const response = await api.post<AuthValidateResponse>('/api/auth/validate', {
        accessKey: key,
      })

      if (response.valid) {
        accessKey.value = key
        setAccessKey(key)
        return true
      } else {
        error.value = response.message || 'Invalid access key'
        return false
      }
    } catch (err) {
      console.error('Failed to validate access key:', err)
      error.value = err instanceof Error ? err.message : 'Failed to validate access key'
      return false
    } finally {
      isValidating.value = false
    }
  }

  /**
   * Login with access key
   */
  async function login(key: string): Promise<boolean> {
    const isValid = await validateAccessKey(key)
    return isValid
  }

  /**
   * Logout and clear access key
   */
  function logout(): void {
    accessKey.value = null
    clearAccessKey()
  }

  /**
   * Initialize auth state
   */
  async function initialize(): Promise<void> {
    await checkAuthRequired()
    
    // If auth is required and we have a stored key, validate it
    if (authRequired.value && accessKey.value) {
      const isValid = await validateAccessKey(accessKey.value)
      if (!isValid) {
        logout()
      }
    }
  }

  return {
    // State
    accessKey: computed(() => accessKey.value),
    authRequired: computed(() => authRequired.value),
    isAuthenticated,
    isChecking: computed(() => isChecking.value),
    isValidating: computed(() => isValidating.value),
    error: computed(() => error.value),

    // Actions
    checkAuthRequired,
    validateAccessKey,
    login,
    logout,
    initialize,
  }
}
