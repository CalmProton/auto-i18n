/**
 * API Client Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, getAccessKey, setAccessKey, clearAccessKey, ApiError } from '@/lib/api-client'

describe('API Client', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    // Reset fetch mock
    global.fetch = vi.fn()
  })

  describe('Access Key Management', () => {
    it('should store access key in localStorage', () => {
      setAccessKey('test-key')
      expect(getAccessKey()).toBe('test-key')
      expect(localStorage.getItem('accessKey')).toBe('test-key')
    })

    it('should retrieve access key from localStorage', () => {
      localStorage.setItem('accessKey', 'stored-key')
      expect(getAccessKey()).toBe('stored-key')
    })

    it('should return null when no access key is stored', () => {
      expect(getAccessKey()).toBeNull()
    })

    it('should clear access key from localStorage', () => {
      setAccessKey('test-key')
      expect(getAccessKey()).toBe('test-key')

      clearAccessKey()
      expect(getAccessKey()).toBeNull()
      expect(localStorage.getItem('accessKey')).toBeNull()
    })
  })

  describe('API Requests', () => {
    it('should make GET request successfully', async () => {
      const mockResponse = { data: 'test' }
      
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      })

      const result = await api.get('/test')
      
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(result).toEqual(mockResponse)
    })

    it('should make POST request with body', async () => {
      const mockResponse = { success: true }
      const requestBody = { key: 'value' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      })

      const result = await api.post('/test', requestBody)

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(result).toEqual(mockResponse)
    })

    it('should include access key in request headers when set', async () => {
      setAccessKey('test-access-key')

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      })

      await api.get('/test')

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-access-key': 'test-access-key',
          }),
        })
      )
    })

    it('should not include access key header when not set', async () => {
      clearAccessKey()

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      })

      await api.get('/test')

      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers
      expect(headers['x-access-key']).toBeUndefined()
    })

    it('should handle 401 Unauthorized by clearing access key', async () => {
      setAccessKey('test-key')

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Unauthorized' }),
      })

      try {
        await api.get('/test')
        expect.fail('Should have thrown ApiError')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(401)
        expect(getAccessKey()).toBeNull()
      }
    })

    it('should throw ApiError for non-ok responses', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Bad Request' }),
      })

      try {
        await api.get('/test')
        expect.fail('Should have thrown ApiError')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(400)
        expect((error as ApiError).message).toBe('Bad Request')
      }
    })

    it('should handle non-JSON responses', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'Plain text response',
      })

      const result = await api.get('/test')
      expect(result).toBe('Plain text response')
    })

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

      try {
        await api.get('/test')
        expect.fail('Should have thrown ApiError')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).message).toBe('Network error')
      }
    })

    it('should make PUT request', async () => {
      const mockResponse = { updated: true }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      })

      const result = await api.put('/test', { data: 'value' })

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'PUT',
        })
      )
      expect(result).toEqual(mockResponse)
    })

    it('should make DELETE request', async () => {
      const mockResponse = { deleted: true }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      })

      const result = await api.delete('/test')

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
      expect(result).toEqual(mockResponse)
    })
  })

  describe('ApiError', () => {
    it('should create ApiError with message and status', () => {
      const error = new ApiError('Test error', 400)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Test error')
      expect(error.status).toBe(400)
      expect(error.name).toBe('ApiError')
    })

    it('should include optional data in ApiError', () => {
      const errorData = { field: 'email', reason: 'invalid' }
      const error = new ApiError('Validation failed', 422, errorData)
      expect(error.data).toEqual(errorData)
    })
  })
})
