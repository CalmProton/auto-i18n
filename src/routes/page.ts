import { Hono } from 'hono'
import { processPageTranslations } from '../services/fileProcessor'
import { extractLocale, parsePageUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'

const pageTranslationRoutes = new Hono()

// Upload endpoint for page translation files
// Structure: multiple folders, each containing [locale].json
pageTranslationRoutes.post('/', async (c) => {
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
    
    // Parse and validate page upload request
    const pageRequest = parsePageUpload(body, locale)
    if (typeof pageRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: pageRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the files
    const result = await processPageTranslations(pageRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }
    
    const response: FileUploadResponse = {
      message: result.message,
      locale: pageRequest.locale,
      filesProcessed: pageRequest.folders.length,
      folders: pageRequest.folders.map(f => ({ name: f.folderName, fileCount: 1 }))
    }
    
    return c.json(response)
    
  } catch (error) {
    console.error('Error processing page translation files:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process page translation files'
    }
    return c.json(errorResponse, 500)
  }
})

export default pageTranslationRoutes