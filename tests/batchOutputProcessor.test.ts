import { describe, it, expect } from 'bun:test'
import {
  decodeUnicodeEscapes,
  parseBatchOutputLine,
  parseCustomId,
  extractTranslatedContent
} from '../src/services/translation/batchOutputProcessor'

describe('batchOutputProcessor', () => {
  describe('decodeUnicodeEscapes', () => {
    it('should decode Arabic Unicode escape sequences', () => {
      const input = '\\u0645\\u062f\\u0639\\u0648\\u0645\\u0629'
      const output = decodeUnicodeEscapes(input)
      expect(output).toBe('مدعومة')
    })

    it('should decode mixed content', () => {
      const input = 'title: \\u062f\\u0644\\u064a\\u0644 \\u0623\\u062f\\u0627\\u0629'
      const output = decodeUnicodeEscapes(input)
      expect(output).toBe('title: دليل أداة')
    })

    it('should handle regular text without escapes', () => {
      const input = 'Hello World'
      const output = decodeUnicodeEscapes(input)
      expect(output).toBe('Hello World')
    })

    it('should handle mixed Unicode and ASCII', () => {
      const input = 'description: \\u0645\\u062f\\u0639\\u0648\\u0645\\u0629 by AI'
      const output = decodeUnicodeEscapes(input)
      expect(output).toBe('description: مدعومة by AI')
    })
  })

  describe('parseCustomId', () => {
    it('should parse valid custom_id', () => {
      const customId = 'markdown_content_ar_31b557a51088a9e3_og_logo-remover-guide.md'
      const result = parseCustomId(customId)
      
      expect(result).not.toBeNull()
      expect(result?.format).toBe('markdown')
      expect(result?.type).toBe('content')
      expect(result?.targetLocale).toBe('ar')
      expect(result?.hash).toBe('31b557a51088a9e3')
      expect(result?.pathFragment).toBe('og_logo-remover-guide.md')
    })

    it('should parse JSON format custom_id', () => {
      const customId = 'json_global_fr_a1b2c3d4e5f6g7h8_en.json'
      const result = parseCustomId(customId)
      
      expect(result).not.toBeNull()
      expect(result?.format).toBe('json')
      expect(result?.type).toBe('global')
      expect(result?.targetLocale).toBe('fr')
    })

    it('should return null for invalid custom_id', () => {
      const customId = 'invalid_format'
      const result = parseCustomId(customId)
      
      expect(result).toBeNull()
    })
  })

  describe('parseBatchOutputLine', () => {
    it('should parse valid batch output line', () => {
      const line = JSON.stringify({
        id: 'batch_req_68e065051cbc8190a840748fccf34e70',
        custom_id: 'markdown_content_ar_31b557a51088a9e3_og_logo-remover-guide.md',
        response: {
          status_code: 200,
          request_id: '9aa6b669083dd1ac9145255fc6c4ed4c',
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 1759535969,
            model: 'gpt-5-mini',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'Test content',
                refusal: null
              },
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300
            }
          }
        },
        error: null
      })

      const result = parseBatchOutputLine(line)
      
      expect(result).not.toBeNull()
      expect(result?.custom_id).toBe('markdown_content_ar_31b557a51088a9e3_og_logo-remover-guide.md')
      expect(result?.response.status_code).toBe(200)
    })

    it('should return null for invalid JSON', () => {
      const line = 'invalid json{'
      const result = parseBatchOutputLine(line)
      
      expect(result).toBeNull()
    })
  })

  describe('extractTranslatedContent', () => {
    it('should extract and decode content from valid output line', () => {
      const outputLine = {
        id: 'batch_req_test',
        custom_id: 'markdown_content_ar_test',
        response: {
          status_code: 200,
          request_id: 'test-request',
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 1759535969,
            model: 'gpt-5-mini',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'title: \\u0645\\u062f\\u0639\\u0648\\u0645\\u0629',
                refusal: null
              },
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300
            }
          }
        },
        error: null
      }

      const result = extractTranslatedContent(outputLine)
      
      expect(result).not.toBeNull()
      expect(result).toBe('title: مدعومة')
    })

    it('should return null for non-200 status', () => {
      const outputLine = {
        id: 'batch_req_test',
        custom_id: 'markdown_content_ar_test',
        response: {
          status_code: 500,
          request_id: 'test-request',
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 1759535969,
            model: 'gpt-5-mini',
            choices: [],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0
            }
          }
        },
        error: 'Server error'
      }

      const result = extractTranslatedContent(outputLine)
      
      expect(result).toBeNull()
    })
  })
})
