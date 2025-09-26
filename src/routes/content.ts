import { Hono } from 'hono'
import { processContentFiles } from '../services/fileProcessor'
import { extractLocale, parseContentUpload } from '../utils/fileValidation'
import type { FileUploadResponse, ErrorResponse } from '../types'

const contentRoutes = new Hono()

// Upload endpoint for content files
// Structure: content/[locale]/[folder_name]/[files].md
contentRoutes.post('/', async (c) => {
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
    
    // Parse and validate content upload request
    const contentRequest = parseContentUpload(body, locale)
    if (typeof contentRequest === 'string') {
      const errorResponse: ErrorResponse = {
        error: contentRequest
      }
      return c.json(errorResponse, 400)
    }
    
    // Process the files
    const result = await processContentFiles(contentRequest)
    
    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: result.message
      }
      return c.json(errorResponse, 500)
    }
    
    const response: FileUploadResponse = {
      message: result.message,
      locale: contentRequest.locale,
      folderName: contentRequest.folderName,
      filesProcessed: contentRequest.files.length,
      files: contentRequest.files.map(f => ({ name: f.name, size: f.size }))
    }
    
    return c.json(response)
    
  } catch (error) {
    console.error('Error processing content files:', error)
    const errorResponse: ErrorResponse = {
      error: 'Failed to process content files'
    }
    return c.json(errorResponse, 500)
  }
})

export default contentRoutes