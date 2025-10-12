/**
 * File Storage Utils Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  saveFileToTemp,
  saveFilesToTemp,
  resolveUploadPath,
} from '@server/utils/fileStorage'

describe('File Storage Utils', () => {
  let tempDir: string
  let originalTempDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-i18n-storage-test-'))
    originalTempDir = process.env.AUTO_I18N_TEMP_DIR
    process.env.AUTO_I18N_TEMP_DIR = tempDir
  })

  afterEach(() => {
    if (originalTempDir !== undefined) {
      process.env.AUTO_I18N_TEMP_DIR = originalTempDir
    } else {
      delete process.env.AUTO_I18N_TEMP_DIR
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('resolveUploadPath', () => {
    it('should resolve upload path correctly', () => {
      const path = resolveUploadPath({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
      })

      expect(path).toContain('test-sender')
      expect(path).toContain('uploads')
      expect(path).toContain('en')
      expect(path).toContain('content')
    })

    it('should create consistent paths for same parameters', () => {
      const params = {
        senderId: 'test-sender',
        locale: 'en',
        type: 'content' as const,
        category: 'uploads' as const,
      }

      const path1 = resolveUploadPath(params)
      const path2 = resolveUploadPath(params)

      expect(path1).toBe(path2)
    })

    it('should create different paths for different senders', () => {
      const path1 = resolveUploadPath({
        senderId: 'sender-1',
        locale: 'en',
        type: 'content',
        category: 'uploads',
      })

      const path2 = resolveUploadPath({
        senderId: 'sender-2',
        locale: 'en',
        type: 'content',
        category: 'uploads',
      })

      expect(path1).not.toBe(path2)
    })

    it('should create different paths for different locales', () => {
      const path1 = resolveUploadPath({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
      })

      const path2 = resolveUploadPath({
        senderId: 'test-sender',
        locale: 'fr',
        type: 'content',
        category: 'uploads',
      })

      expect(path1).not.toBe(path2)
    })
  })

  // resolveTempPath is not exported, so we'll skip these tests

  describe('saveFileToTemp', () => {
    it('should save a file to temp directory', async () => {
      const file = new File(['Test content'], 'test.md', { type: 'text/markdown' })
      
      const savedFile = await saveFileToTemp({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
        file,
      })

      expect(savedFile.name).toBe('test.md')
      expect(savedFile.size).toBe(file.size)
      expect(savedFile.type).toBe('content')
      expect(existsSync(savedFile.path)).toBe(true)
    })

    it('should save file with folder structure', async () => {
      const file = new File(['Blog content'], 'post.md', { type: 'text/markdown' })
      
      const savedFile = await saveFileToTemp({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
        file,
        folderName: 'blog',
      })

      expect(savedFile.folder).toBe('blog')
      expect(savedFile.path).toContain('blog')
      expect(existsSync(savedFile.path)).toBe(true)
    })

    it('should handle special characters in filename', async () => {
      const file = new File(['Content'], 'test file (1).md', { type: 'text/markdown' })
      
      const savedFile = await saveFileToTemp({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
        file,
      })

      expect(savedFile.name).toBe('test file (1).md')
      expect(existsSync(savedFile.path)).toBe(true)
    })

    it('should save file content correctly', async () => {
      const content = '# Test Content\n\nThis is a test.'
      const file = new File([content], 'test.md', { type: 'text/markdown' })
      
      const savedFile = await saveFileToTemp({
        senderId: 'test-sender',
        locale: 'en',
        type: 'content',
        category: 'uploads',
        file,
      })

      const savedContent = await Bun.file(savedFile.path).text()
      expect(savedContent).toBe(content)
    })
  })

  describe('saveFilesToTemp', () => {
    it('should save multiple files', async () => {
      const files = [
        { file: new File(['Content 1'], 'file1.md', { type: 'text/markdown' }) },
        { file: new File(['Content 2'], 'file2.md', { type: 'text/markdown' }) },
        { file: new File(['Content 3'], 'file3.md', { type: 'text/markdown' }) },
      ]

      const savedFiles = await saveFilesToTemp(
        {
          senderId: 'test-sender',
          locale: 'en',
          type: 'content',
          category: 'uploads',
        },
        files
      )

      expect(savedFiles.length).toBe(3)
      expect(savedFiles[0]?.name).toBe('file1.md')
      expect(savedFiles[1]?.name).toBe('file2.md')
      expect(savedFiles[2]?.name).toBe('file3.md')
      
      savedFiles.forEach((saved) => {
        expect(existsSync(saved.path)).toBe(true)
      })
    })

    it('should save files with different folder names', async () => {
      const files = [
        { 
          file: new File(['Content 1'], 'file1.md', { type: 'text/markdown' }),
          folderName: 'blog',
        },
        { 
          file: new File(['Content 2'], 'file2.md', { type: 'text/markdown' }),
          folderName: 'docs',
        },
      ]

      const savedFiles = await saveFilesToTemp(
        {
          senderId: 'test-sender',
          locale: 'en',
          type: 'content',
          category: 'uploads',
        },
        files
      )

      expect(savedFiles.length).toBe(2)
      expect(savedFiles[0]?.folder).toBe('blog')
      expect(savedFiles[1]?.folder).toBe('docs')
      expect(savedFiles[0]?.path).toContain('blog')
      expect(savedFiles[1]?.path).toContain('docs')
    })

    it('should return empty array for no files', async () => {
      const savedFiles = await saveFilesToTemp(
        {
          senderId: 'test-sender',
          locale: 'en',
          type: 'content',
          category: 'uploads',
        },
        []
      )

      expect(savedFiles.length).toBe(0)
    })

    it('should maintain order of saved files', async () => {
      const files = [
        { file: new File(['A'], 'a.md', { type: 'text/markdown' }) },
        { file: new File(['B'], 'b.md', { type: 'text/markdown' }) },
        { file: new File(['C'], 'c.md', { type: 'text/markdown' }) },
      ]

      const savedFiles = await saveFilesToTemp(
        {
          senderId: 'test-sender',
          locale: 'en',
          type: 'content',
          category: 'uploads',
        },
        files
      )

      expect(savedFiles[0]?.name).toBe('a.md')
      expect(savedFiles[1]?.name).toBe('b.md')
      expect(savedFiles[2]?.name).toBe('c.md')
    })
  })
})
