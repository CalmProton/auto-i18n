/**
 * Authentication Middleware
 * Simple password protection for the dashboard API
 */

import { Elysia } from 'elysia'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('middleware:auth')

/**
 * Get the ACCESS_KEY from environment
 */
function getAccessKey(): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env.ACCESS_KEY
  }
  if (typeof process !== 'undefined') {
    return process.env?.ACCESS_KEY
  }
  return undefined
}

/**
 * Check if authentication is required
 */
export function isAuthRequired(): boolean {
  const accessKey = getAccessKey()
  return !!accessKey && accessKey.trim().length > 0
}

/**
 * Validate the provided access key
 */
export function validateAccessKey(providedKey: string): boolean {
  const accessKey = getAccessKey()
  if (!accessKey) {
    return true // No auth configured, allow all requests
  }
  return providedKey === accessKey
}

/**
 * Authentication middleware for Elysia
 */
export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(({ request, set }) => {
    // Skip auth for health check and auth check endpoints
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/' || path === '/api/auth/check') {
      return {}
    }

    // Check if authentication is required
    if (!isAuthRequired()) {
      return {}
    }

    // Get access key from header or query parameter
    const authHeader = request.headers.get('x-access-key')
    const queryAccessKey = url.searchParams.get('access_key')
    const providedKey = authHeader || queryAccessKey || ''

    // Validate access key
    if (!validateAccessKey(providedKey)) {
      log.warn('Unauthorized access attempt', { path })
      set.status = 401
      set.headers['www-authenticate'] = 'Access-Key'
      throw new Error('Unauthorized: Invalid or missing access key')
    }

    return {}
  })

/**
 * Create auth check endpoint
 */
export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .get('/check', () => {
    return {
      authRequired: isAuthRequired(),
      authenticated: false, // Will be set by the client based on their key
    }
  })
  .post('/validate', ({ body }) => {
    const { accessKey } = body as { accessKey: string }
    
    if (!isAuthRequired()) {
      return { valid: true, message: 'Authentication not required' }
    }

    const isValid = validateAccessKey(accessKey)
    return {
      valid: isValid,
      message: isValid ? 'Access key is valid' : 'Invalid access key',
    }
  })
