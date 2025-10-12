/**
 * Content Routes Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import contentRoutes from '@server/routes/content'
import { authMiddleware } from '@server/middleware/auth'

describe('Content Routes', () => {
  let tempDir: string
  let originalTempDir: string | undefined
  let originalAccessKey: string | undefined
  let app: Elysia

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-i18n-routes-test-'))
    originalTempDir = process.env.AUTO_I18N_TEMP_DIR
    originalAccessKey = process.env.ACCESS_KEY
    
    process.env.AUTO_I18N_TEMP_DIR = tempDir
    delete process.env.ACCESS_KEY // Disable auth for tests

    app = new Elysia()
      .use(authMiddleware)
      .use(contentRoutes)
  })

  afterEach(() => {
    if (originalTempDir !== undefined) {
      process.env.AUTO_I18N_TEMP_DIR = originalTempDir
    } else {
      delete process.env.AUTO_I18N_TEMP_DIR
    }
    
    if (originalAccessKey !== undefined) {
      process.env.ACCESS_KEY = originalAccessKey
    } else {
      delete process.env.ACCESS_KEY
    }
    
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('POST /translate/content', () => {
    it('should reject request without locale', async () => {
      const formData = new FormData()
      formData.append('senderId', 'test-sender')

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Locale')
    })

    it('should reject request without senderId', async () => {
      const formData = new FormData()
      formData.append('locale', 'en')

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Sender')
    })

    it('should reject unsupported locale', async () => {
      const formData = new FormData()
      formData.append('locale', 'xyz')
      formData.append('senderId', 'test-sender')

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('not supported')
    })

    it('should accept valid content upload', async () => {
      const file = new File(['# Test Content'], 'test.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_test', file)

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBeTruthy()
      expect(data.filesProcessed).toBe(1)
      expect(data.senderId).toBe('test-sender')
      expect(data.locale).toBe('en')
    })

    it('should accept multiple content files', async () => {
      const file1 = new File(['# Content 1'], 'file1.md', { type: 'text/markdown' })
      const file2 = new File(['# Content 2'], 'file2.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_file1', file1)
      formData.append('folder_blog_file2', file2)

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.filesProcessed).toBe(2)
    })

    it('should reject non-markdown files', async () => {
      const file = new File(['Test'], 'test.txt', { type: 'text/plain' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_test', file)

      const response = await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Invalid')
    })

    it('should handle locale from query parameter', async () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_test', file)

      const response = await app.handle(
        new Request('http://localhost/translate/content?locale=en', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.locale).toBe('en')
    })

    it('should handle senderId from query parameter', async () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('folder_blog_test', file)

      const response = await app.handle(
        new Request('http://localhost/translate/content?senderId=query-sender', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.senderId).toBe('query-sender')
    })
  })

  describe('POST /translate/content/trigger', () => {
    it('should reject trigger without senderId', async () => {
      const response = await app.handle(
        new Request('http://localhost/translate/content/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceLocale: 'en' }),
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBeTruthy()
    })

    it('should reject trigger without sourceLocale', async () => {
      const response = await app.handle(
        new Request('http://localhost/translate/content/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderId: 'test-sender' }),
        })
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBeTruthy()
    })

    it('should accept valid trigger request', async () => {
      // First upload a file
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_test', file)

      await app.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      // Then trigger translation
      const response = await app.handle(
        new Request('http://localhost/translate/content/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: 'test-sender',
            sourceLocale: 'en',
            targetLocales: ['fr'],
          }),
        })
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBeTruthy()
    })
  })

  describe('Authentication', () => {
    it('should block requests when access key is required but not provided', async () => {
      process.env.ACCESS_KEY = 'secret-key'
      
      const appWithAuth = new Elysia()
        .use(authMiddleware)
        .use(contentRoutes)

      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')

      const response = await appWithAuth.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          body: formData,
        })
      )

      expect(response.status).toBe(401)
    })

    it('should allow requests with correct access key', async () => {
      process.env.ACCESS_KEY = 'secret-key'
      
      const appWithAuth = new Elysia()
        .use(authMiddleware)
        .use(contentRoutes)

      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('locale', 'en')
      formData.append('senderId', 'test-sender')
      formData.append('folder_blog_test', file)

      const response = await appWithAuth.handle(
        new Request('http://localhost/translate/content', {
          method: 'POST',
          headers: { 'x-access-key': 'secret-key' },
          body: formData,
        })
      )

      expect(response.status).toBe(200)
    })
  })
})
