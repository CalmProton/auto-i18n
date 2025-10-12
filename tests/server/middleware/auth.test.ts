/**
 * Authentication Middleware Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { authMiddleware, authRoutes, isAuthRequired, validateAccessKey } from '@server/middleware/auth'

describe('Authentication Middleware', () => {
  let originalAccessKey: string | undefined

  beforeEach(() => {
    originalAccessKey = process.env.ACCESS_KEY
  })

  afterEach(() => {
    if (originalAccessKey !== undefined) {
      process.env.ACCESS_KEY = originalAccessKey
    } else {
      delete process.env.ACCESS_KEY
    }
  })

  describe('isAuthRequired', () => {
    it('should return false when ACCESS_KEY is not set', () => {
      delete process.env.ACCESS_KEY
      expect(isAuthRequired()).toBe(false)
    })

    it('should return false when ACCESS_KEY is empty', () => {
      process.env.ACCESS_KEY = ''
      expect(isAuthRequired()).toBe(false)
    })

    it('should return false when ACCESS_KEY is only whitespace', () => {
      process.env.ACCESS_KEY = '   '
      expect(isAuthRequired()).toBe(false)
    })

    it('should return true when ACCESS_KEY is set', () => {
      process.env.ACCESS_KEY = 'test-key-123'
      expect(isAuthRequired()).toBe(true)
    })
  })

  describe('validateAccessKey', () => {
    it('should return true when no ACCESS_KEY is configured', () => {
      delete process.env.ACCESS_KEY
      expect(validateAccessKey('any-key')).toBe(true)
    })

    it('should return true when provided key matches', () => {
      process.env.ACCESS_KEY = 'secret-key'
      expect(validateAccessKey('secret-key')).toBe(true)
    })

    it('should return false when provided key does not match', () => {
      process.env.ACCESS_KEY = 'secret-key'
      expect(validateAccessKey('wrong-key')).toBe(false)
    })

    it('should return false when provided key is empty', () => {
      process.env.ACCESS_KEY = 'secret-key'
      expect(validateAccessKey('')).toBe(false)
    })
  })

  describe('authRoutes', () => {
    it('should return authRequired status on /api/auth/check', async () => {
      delete process.env.ACCESS_KEY
      const app = new Elysia().use(authRoutes)

      const response = await app.handle(
        new Request('http://localhost/api/auth/check')
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.authRequired).toBe(false)
    })

    it('should validate correct access key', async () => {
      process.env.ACCESS_KEY = 'correct-key'
      const app = new Elysia().use(authRoutes)

      const response = await app.handle(
        new Request('http://localhost/api/auth/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey: 'correct-key' }),
        })
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should reject incorrect access key', async () => {
      process.env.ACCESS_KEY = 'correct-key'
      const app = new Elysia().use(authRoutes)

      const response = await app.handle(
        new Request('http://localhost/api/auth/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessKey: 'wrong-key' }),
        })
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.valid).toBe(false)
    })
  })

  describe('authMiddleware', () => {
    it('should allow requests when auth is not required', async () => {
      delete process.env.ACCESS_KEY
      const app = new Elysia()
        .use(authMiddleware)
        .get('/test', () => ({ message: 'success' }))

      const response = await app.handle(
        new Request('http://localhost/test')
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('success')
    })

    it('should block requests without access key when auth is required', async () => {
      // Set both process.env and Bun.env
      process.env.ACCESS_KEY = 'required-key'
      if (typeof Bun !== 'undefined') {
        Bun.env.ACCESS_KEY = 'required-key'
      }
      
      const app = new Elysia()
        .use(authMiddleware)
        .get('/test', () => ({ message: 'success' }))

      const response = await app.handle(
        new Request('http://localhost/test')
      )

      expect(response.status).toBe(401)
      
      // Clean up
      delete process.env.ACCESS_KEY
      if (typeof Bun !== 'undefined') {
        delete Bun.env.ACCESS_KEY
      }
    })

    it('should allow requests with correct access key in header', async () => {
      process.env.ACCESS_KEY = 'correct-key'
      const app = new Elysia()
        .use(authMiddleware)
        .get('/test', () => ({ message: 'success' }))

      const response = await app.handle(
        new Request('http://localhost/test', {
          headers: { 'x-access-key': 'correct-key' },
        })
      )

      expect(response.status).toBe(200)
    })

    it('should allow requests with correct access key in query param', async () => {
      process.env.ACCESS_KEY = 'correct-key'
      const app = new Elysia()
        .use(authMiddleware)
        .get('/test', () => ({ message: 'success' }))

      const response = await app.handle(
        new Request('http://localhost/test?access_key=correct-key')
      )

      expect(response.status).toBe(200)
    })

    it('should always allow requests to root endpoint', async () => {
      process.env.ACCESS_KEY = 'required-key'
      const app = new Elysia()
        .use(authMiddleware)
        .get('/', () => ({ message: 'root' }))

      const response = await app.handle(
        new Request('http://localhost/')
      )

      expect(response.status).toBe(200)
    })

    it('should always allow requests to /api/auth/check', async () => {
      process.env.ACCESS_KEY = 'required-key'
      const app = new Elysia()
        .use(authMiddleware)
        .get('/api/auth/check', () => ({ authRequired: true }))

      const response = await app.handle(
        new Request('http://localhost/api/auth/check')
      )

      expect(response.status).toBe(200)
    })
  })
})
