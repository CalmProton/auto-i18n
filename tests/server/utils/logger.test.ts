/**
 * Logger Utility Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createScopedLogger } from '@server/utils/logger'
import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Logger Utility', () => {
  let tempDir: string
  let originalLogDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-i18n-logger-test-'))
    originalLogDir = process.env.AUTO_I18N_LOG_DIR
    process.env.AUTO_I18N_LOG_DIR = join(tempDir, 'logs')
  })

  afterEach(() => {
    if (originalLogDir !== undefined) {
      process.env.AUTO_I18N_LOG_DIR = originalLogDir
    } else {
      delete process.env.AUTO_I18N_LOG_DIR
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('createScopedLogger', () => {
    it('should create a logger with the given scope', () => {
      const logger = createScopedLogger('test:scope')
      expect(logger).toBeDefined()
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.debug).toBe('function')
    })

    it('should not throw when logging info', () => {
      const logger = createScopedLogger('test')
      expect(() => {
        logger.info('Test message')
      }).not.toThrow()
    })

    it('should not throw when logging with metadata', () => {
      const logger = createScopedLogger('test')
      expect(() => {
        logger.info('Test message', { key: 'value' })
      }).not.toThrow()
    })

    it('should not throw when logging warn', () => {
      const logger = createScopedLogger('test')
      expect(() => {
        logger.warn('Warning message')
      }).not.toThrow()
    })

    it('should not throw when logging error', () => {
      const logger = createScopedLogger('test')
      expect(() => {
        logger.error('Error message')
      }).not.toThrow()
    })

    it('should not throw when logging debug', () => {
      const logger = createScopedLogger('test')
      expect(() => {
        logger.debug('Debug message')
      }).not.toThrow()
    })

    it('should handle error objects in metadata', () => {
      const logger = createScopedLogger('test')
      const error = new Error('Test error')
      expect(() => {
        logger.error('Error occurred', { error })
      }).not.toThrow()
    })

    it('should handle complex metadata objects', () => {
      const logger = createScopedLogger('test')
      const metadata = {
        senderId: 'test-123',
        files: ['file1.md', 'file2.md'],
        nested: {
          key: 'value',
        },
      }
      expect(() => {
        logger.info('Complex metadata', metadata)
      }).not.toThrow()
    })

    it('should create log directory if it does not exist', () => {
      const logger = createScopedLogger('test')
      logger.info('Test message')
      
      // Log directory should be created
      expect(existsSync(process.env.AUTO_I18N_LOG_DIR!)).toBe(true)
    })

    it('should allow multiple loggers with different scopes', () => {
      const logger1 = createScopedLogger('scope1')
      const logger2 = createScopedLogger('scope2')

      expect(() => {
        logger1.info('Message from scope1')
        logger2.info('Message from scope2')
      }).not.toThrow()
    })
  })
})
