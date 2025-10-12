/**
 * useAuth Composable Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuth } from '@/composables/useAuth'
import * as apiClient from '@/lib/api-client'

describe('useAuth Composable', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('isAuthenticated', () => {
    it('should return true when auth is not required', async () => {
      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: false,
        authenticated: false,
      })

      const auth = useAuth()
      await auth.checkAuthRequired()

      expect(auth.isAuthenticated.value).toBe(true)
    })

    it('should return false when auth is required and no key is set', async () => {
      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      const auth = useAuth()
      await auth.checkAuthRequired()

      expect(auth.isAuthenticated.value).toBe(false)
    })

    it('should return true when auth is required and key is set', async () => {
      apiClient.setAccessKey('test-key')

      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      const auth = useAuth()
      await auth.checkAuthRequired()

      expect(auth.isAuthenticated.value).toBe(true)
    })
  })

  describe('checkAuthRequired', () => {
    it('should call API and set authRequired', async () => {
      const getSpy = vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      const auth = useAuth()
      const result = await auth.checkAuthRequired()

      expect(getSpy).toHaveBeenCalledWith('/api/auth/check')
      expect(result).toBe(true)
    })

    it('should handle API errors gracefully', async () => {
      vi.spyOn(apiClient.api, 'get').mockRejectedValueOnce(
        new Error('Network error')
      )

      const auth = useAuth()
      const result = await auth.checkAuthRequired()

      expect(result).toBe(false)
      expect(auth.error.value).toBeTruthy()
    })

    it('should set isChecking flag during API call', async () => {
      let resolvePromise: (value: any) => void
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      vi.spyOn(apiClient.api, 'get').mockReturnValueOnce(promise as any)

      const auth = useAuth()
      const checkPromise = auth.checkAuthRequired()

      expect(auth.isChecking.value).toBe(true)

      resolvePromise!({ authRequired: false, authenticated: false })
      await checkPromise

      expect(auth.isChecking.value).toBe(false)
    })
  })

  describe('validateAccessKey', () => {
    it('should validate correct access key', async () => {
      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: true,
        message: 'Valid key',
      })

      const auth = useAuth()
      const result = await auth.validateAccessKey('correct-key')

      expect(result).toBe(true)
      expect(apiClient.getAccessKey()).toBe('correct-key')
    })

    it('should reject incorrect access key', async () => {
      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: false,
        message: 'Invalid key',
      })

      const auth = useAuth()
      const result = await auth.validateAccessKey('wrong-key')

      expect(result).toBe(false)
      expect(auth.error.value).toBeTruthy()
    })

    it('should handle API errors', async () => {
      vi.spyOn(apiClient.api, 'post').mockRejectedValueOnce(
        new Error('Network error')
      )

      const auth = useAuth()
      const result = await auth.validateAccessKey('test-key')

      expect(result).toBe(false)
      expect(auth.error.value).toBeTruthy()
    })
  })

  describe('login', () => {
    it('should login with valid key', async () => {
      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: true,
        message: 'Valid key',
      })

      const auth = useAuth()
      const result = await auth.login('valid-key')

      expect(result).toBe(true)
      expect(apiClient.getAccessKey()).toBe('valid-key')
    })

    it('should fail login with invalid key', async () => {
      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: false,
        message: 'Invalid key',
      })

      const auth = useAuth()
      const result = await auth.login('invalid-key')

      expect(result).toBe(false)
    })
  })

  describe('logout', () => {
    it('should clear access key from localStorage', () => {
      apiClient.setAccessKey('test-key')
      expect(apiClient.getAccessKey()).toBe('test-key')

      const auth = useAuth()
      auth.logout()

      expect(apiClient.getAccessKey()).toBeNull()
    })

    it('should clear access key from composable state', async () => {
      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: true,
        message: 'Valid key',
      })
      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      const auth = useAuth()
      await auth.login('test-key')
      await auth.checkAuthRequired()

      expect(auth.isAuthenticated.value).toBe(true)

      auth.logout()

      expect(auth.isAuthenticated.value).toBe(false)
    })
  })

  describe('initialize', () => {
    it('should check auth requirement on initialization', async () => {
      const getSpy = vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: false,
        authenticated: false,
      })

      const auth = useAuth()
      await auth.initialize()

      expect(getSpy).toHaveBeenCalledWith('/api/auth/check')
    })

    it('should validate stored key if auth is required', async () => {
      apiClient.setAccessKey('stored-key')

      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      const postSpy = vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: true,
        message: 'Valid key',
      })

      const auth = useAuth()
      await auth.initialize()

      expect(postSpy).toHaveBeenCalledWith('/api/auth/validate', {
        accessKey: 'stored-key',
      })
    })

    it('should logout if stored key is invalid', async () => {
      apiClient.setAccessKey('invalid-stored-key')

      vi.spyOn(apiClient.api, 'get').mockResolvedValueOnce({
        authRequired: true,
        authenticated: false,
      })

      vi.spyOn(apiClient.api, 'post').mockResolvedValueOnce({
        valid: false,
        message: 'Invalid key',
      })

      const auth = useAuth()
      await auth.initialize()

      expect(apiClient.getAccessKey()).toBeNull()
    })
  })
})
