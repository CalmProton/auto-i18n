import { Hono } from 'hono'
import { processGlobalTranslation } from '../services/fileProcessor'
import { extractLocale, parseGlobalUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'

const globalTranslationRoutes = new Hono()

// Upload endpoint for global translation file
// Structure: [locale].json
globalTranslationRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody()
    
    // Extract locale from query or body
    const locale = c.req.query('locale') || extractLocale(body)
    if (!locale) {
      const errorResponse: ErrorResponse = {
        error: 'Locale parameter is required'
      }
      return c.json(errorResponse, 400)
    }
    
    // Parse and validate global upload request
    const globalRequest = parseGlobalUpload(body, locale)
    if (typeof globalRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: globalRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the file
    const result = await processGlobalTranslation(globalRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }
    
    const response: FileUploadResponse = {
      message: result.message,
      locale: globalRequest.locale,
      file: { name: globalRequest.file.name, size: globalRequest.file.size }
    }
    
    return c.json(response)
    
  } catch (error) {
    console.error('Error processing global translation file:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process global translation file'
    }
    return c.json(errorResponse, 500)
  }
})

export default globalTranslationRoutes