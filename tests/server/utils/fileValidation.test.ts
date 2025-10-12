/**
 * File Validation Utils Tests
 */

import { describe, it, expect } from 'bun:test'
import {
  validateContentFile,
  validateJsonFile,
  validateGlobalFile,
  validatePageFile,
  extractLocale,
  extractSenderId,
  parseContentUpload,
} from '@server/utils/fileValidation'

describe('File Validation Utils', () => {
  describe('validateContentFile', () => {
    it('should validate .md file with text/markdown type', () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      expect(validateContentFile(file)).toBe(true)
    })

    it('should validate .md file with text/plain type', () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/plain' })
      expect(validateContentFile(file)).toBe(true)
    })

    it('should validate .md file with empty type', () => {
      const file = new File(['# Test'], 'test.md', { type: '' })
      expect(validateContentFile(file)).toBe(true)
    })

    it('should reject non-.md files', () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      expect(validateContentFile(file)).toBe(false)
    })

    it('should reject .md file with wrong type', () => {
      const file = new File(['test'], 'test.md', { type: 'application/json' })
      expect(validateContentFile(file)).toBe(false)
    })
  })

  describe('validateJsonFile', () => {
    it('should validate .json file with application/json type', () => {
      const file = new File(['{}'], 'test.json', { type: 'application/json' })
      expect(validateJsonFile(file)).toBe(true)
    })

    it('should validate .json file with empty type', () => {
      const file = new File(['{}'], 'test.json', { type: '' })
      expect(validateJsonFile(file)).toBe(true)
    })

    it('should validate .json file with application/octet-stream', () => {
      const file = new File(['{}'], 'test.json', { type: 'application/octet-stream' })
      expect(validateJsonFile(file)).toBe(true)
    })

    it('should validate .json file with text/json type', () => {
      const file = new File(['{}'], 'test.json', { type: 'text/json' })
      expect(validateJsonFile(file)).toBe(true)
    })

    it('should validate .json file with type containing json', () => {
      const file = new File(['{}'], 'test.json', { type: 'application/vnd.api+json' })
      expect(validateJsonFile(file)).toBe(true)
    })

    it('should reject non-.json files', () => {
      const file = new File(['{}'], 'test.txt', { type: 'application/json' })
      expect(validateJsonFile(file)).toBe(false)
    })
  })

  describe('validateGlobalFile', () => {
    it('should validate correctly named global translation file', () => {
      const file = new File(['{}'], 'en.json', { type: 'application/json' })
      expect(validateGlobalFile(file, 'en')).toBe(true)
    })

    it('should reject incorrectly named file', () => {
      const file = new File(['{}'], 'wrong.json', { type: 'application/json' })
      expect(validateGlobalFile(file, 'en')).toBe(false)
    })

    it('should reject correct name but wrong extension', () => {
      const file = new File(['{}'], 'en.txt', { type: 'text/plain' })
      expect(validateGlobalFile(file, 'en')).toBe(false)
    })
  })

  describe('validatePageFile', () => {
    it('should validate correctly named page translation file', () => {
      const file = new File(['{}'], 'fr.json', { type: 'application/json' })
      expect(validatePageFile(file, 'fr')).toBe(true)
    })

    it('should reject incorrectly named file', () => {
      const file = new File(['{}'], 'wrong.json', { type: 'application/json' })
      expect(validatePageFile(file, 'fr')).toBe(false)
    })
  })

  describe('extractLocale', () => {
    it('should extract locale from body', () => {
      const body = { locale: 'en' }
      expect(extractLocale(body)).toBe('en')
    })

    it('should return null when locale is not a string', () => {
      const body = { locale: 123 }
      expect(extractLocale(body)).toBe(null)
    })

    it('should return null when locale is missing', () => {
      const body = {}
      expect(extractLocale(body)).toBe(null)
    })
  })

  describe('extractSenderId', () => {
    it('should extract senderId from body', () => {
      const body = { senderId: 'test-sender' }
      expect(extractSenderId(body)).toBe('test-sender')
    })

    it('should return null when senderId is not a string', () => {
      const body = { senderId: 123 }
      expect(extractSenderId(body)).toBe(null)
    })

    it('should return null when senderId is missing', () => {
      const body = {}
      expect(extractSenderId(body)).toBe(null)
    })
  })

  describe('parseContentUpload', () => {
    it('should parse valid content upload with single file', () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const body = {
        locale: 'en',
        senderId: 'test-sender',
        folder_blog_test: file,
      }

      const result = parseContentUpload(body, 'en', 'test-sender')
      expect(typeof result).toBe('object')
      
      if (typeof result !== 'string') {
        expect(result.locale).toBe('en')
        expect(result.senderId).toBe('test-sender')
        expect(result.files.length).toBe(1)
        expect(result.files[0]?.file).toBe(file)
        expect(result.files[0]?.fieldKey).toBe('folder_blog_test')
      }
    })

    it('should return error when no files provided', () => {
      const body = {
        locale: 'en',
        senderId: 'test-sender',
      }

      const result = parseContentUpload(body, 'en', 'test-sender')
      expect(typeof result).toBe('string')
      expect(result).toBe('No valid content files provided')
    })

    it('should return error for invalid file type', () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      const body = {
        locale: 'en',
        senderId: 'test-sender',
        folder_blog_test: file,
      }

      const result = parseContentUpload(body, 'en', 'test-sender')
      expect(typeof result).toBe('string')
      expect(result).toContain('Invalid content file')
    })

    it('should parse multiple files from different folders', () => {
      const file1 = new File(['# Test 1'], 'test1.md', { type: 'text/markdown' })
      const file2 = new File(['# Test 2'], 'test2.md', { type: 'text/markdown' })
      const body = {
        locale: 'en',
        senderId: 'test-sender',
        folder_blog_test1: file1,
        folder_docs_test2: file2,
      }

      const result = parseContentUpload(body, 'en', 'test-sender')
      expect(typeof result).toBe('object')
      
      if (typeof result !== 'string') {
        expect(result.files.length).toBe(2)
      }
    })

    it('should ignore locale and senderId fields in file processing', () => {
      const file = new File(['# Test'], 'test.md', { type: 'text/markdown' })
      const body = {
        locale: 'en',
        senderId: 'test-sender',
        folder_blog_test: file,
      }

      const result = parseContentUpload(body, 'en', 'test-sender')
      expect(typeof result).toBe('object')
      
      if (typeof result !== 'string') {
        expect(result.files.length).toBe(1)
      }
    })
  })
})
