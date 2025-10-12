/**
 * Job Metadata Utils Tests (Simplified)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadMetadata,
  saveMetadata,
  updateMetadata,
  getMetadataPath,
} from '@server/utils/jobMetadata'
import type { TranslationMetadataFile } from '@server/types'

describe('Job Metadata Utils', () => {
  let tempDir: string
  let originalTempDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-i18n-metadata-test-'))
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

  describe('getMetadataPath', () => {
    it('should return metadata path for senderId', () => {
      const path = getMetadataPath('test-sender')
      expect(path).toContain('test-sender')
      expect(path).toContain('metadata.json')
    })
  })

  describe('saveMetadata and loadMetadata', () => {
    it('should save and load metadata file', async () => {
      const metadata: TranslationMetadataFile = {
        senderId: 'test-sender',
        jobs: [
          {
            id: 'test-job-123',
            files: [],
            sourceLocale: 'en',
            targetLocales: ['fr', 'es'],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveMetadata(metadata)

      const loaded = await loadMetadata('test-sender')
      expect(loaded).not.toBe(null)
      expect(loaded?.senderId).toBe('test-sender')
      expect(loaded?.jobs.length).toBe(1)
      expect(loaded?.jobs[0]?.id).toBe('test-job-123')
    })

    it('should return null for non-existent metadata', async () => {
      const loaded = await loadMetadata('non-existent-sender')
      expect(loaded).toBe(null)
    })

    it('should save metadata with repository info', async () => {
      const metadata: TranslationMetadataFile = {
        senderId: 'test-sender',
        repository: {
          owner: 'test-owner',
          name: 'test-repo',
          baseBranch: 'main',
          baseCommitSha: 'abc123',
        },
        jobs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveMetadata(metadata)

      const loaded = await loadMetadata('test-sender')
      expect(loaded?.repository?.owner).toBe('test-owner')
      expect(loaded?.repository?.name).toBe('test-repo')
    })
  })

  describe('updateMetadata', () => {
    it('should update existing metadata', async () => {
      const initial: TranslationMetadataFile = {
        senderId: 'test-sender',
        jobs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveMetadata(initial)

      const update = {
        sourceLocale: 'en',
        targetLocales: ['fr', 'es'],
      }

      await updateMetadata('test-sender', update)

      const loaded = await loadMetadata('test-sender')
      expect(loaded?.sourceLocale).toBe('en')
      expect(loaded?.targetLocales).toEqual(['fr', 'es'])
    })

    it('should create metadata if it does not exist', async () => {
      const update = {
        sourceLocale: 'en',
        targetLocales: ['fr'],
        jobs: [
          {
            id: 'new-job',
            files: [],
          },
        ],
      }

      await updateMetadata('new-sender', update)

      const loaded = await loadMetadata('new-sender')
      expect(loaded).not.toBe(null)
      expect(loaded?.senderId).toBe('new-sender')
      expect(loaded?.sourceLocale).toBe('en')
      expect(loaded?.jobs.length).toBe(1)
    })

    it('should merge jobs correctly', async () => {
      const initial: TranslationMetadataFile = {
        senderId: 'test-sender',
        jobs: [
          {
            id: 'job-1',
            files: [],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveMetadata(initial)

      const update = {
        jobs: [
          {
            id: 'job-2',
            files: [],
          },
        ],
      }

      await updateMetadata('test-sender', update)

      const loaded = await loadMetadata('test-sender')
      expect(loaded?.jobs.length).toBe(2)
    })
  })
})
