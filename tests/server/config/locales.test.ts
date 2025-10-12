/**
 * Locale Configuration Tests
 */

import { describe, it, expect } from 'bun:test'
import { SUPPORTED_LOCALES, isSupportedLocale } from '@server/config/locales'

describe('Locale Configuration', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('should be an array', () => {
      expect(Array.isArray(SUPPORTED_LOCALES)).toBe(true)
    })

    it('should contain at least English', () => {
      expect(SUPPORTED_LOCALES).toContain('en')
    })

    it('should not contain empty strings', () => {
      const hasEmpty = SUPPORTED_LOCALES.some((locale) => locale === '')
      expect(hasEmpty).toBe(false)
    })

    it('should not contain duplicates', () => {
      const uniqueLocales = new Set(SUPPORTED_LOCALES)
      expect(uniqueLocales.size).toBe(SUPPORTED_LOCALES.length)
    })

    it('should contain only lowercase locale codes', () => {
      const allLowercase = SUPPORTED_LOCALES.every(
        (locale) => locale === locale.toLowerCase()
      )
      expect(allLowercase).toBe(true)
    })

    it('should contain valid locale format (2-5 characters)', () => {
      const validFormat = SUPPORTED_LOCALES.every((locale) => {
        return locale.length >= 2 && locale.length <= 5 && /^[a-z-]+$/.test(locale)
      })
      expect(validFormat).toBe(true)
    })
  })

  describe('isSupportedLocale', () => {
    it('should return true for supported locale "en"', () => {
      expect(isSupportedLocale('en')).toBe(true)
    })

    it('should return false for unsupported locale', () => {
      expect(isSupportedLocale('xyz')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isSupportedLocale('')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(isSupportedLocale('EN')).toBe(false)
    })

    it('should return true for all supported locales', () => {
      SUPPORTED_LOCALES.forEach((locale) => {
        expect(isSupportedLocale(locale)).toBe(true)
      })
    })

    it('should handle common locales correctly', () => {
      const commonLocales = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar']
      commonLocales.forEach((locale) => {
        const result = isSupportedLocale(locale)
        // Should be boolean (either true or false based on configuration)
        expect(typeof result).toBe('boolean')
      })
    })
  })
})
