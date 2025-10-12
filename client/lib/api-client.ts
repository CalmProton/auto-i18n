/**
 * API Client
 * Centralized HTTP client for making API requests
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Get the stored access key from localStorage
 */
export function getAccessKey(): string | null {
  return localStorage.getItem('accessKey')
}

/**
 * Store the access key in localStorage
 */
export function setAccessKey(key: string): void {
  localStorage.setItem('accessKey', key)
}

/**
 * Remove the access key from localStorage
 */
export function clearAccessKey(): void {
  localStorage.removeItem('accessKey')
}

/**
 * Make an API request with automatic auth header injection
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`
  const accessKey = getAccessKey()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  // Add access key to headers if available
  if (accessKey) {
    headers['x-access-key'] = accessKey
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    })

    // Handle 401 Unauthorized
    if (response.status === 401) {
      clearAccessKey()
      throw new ApiError('Unauthorized', 401)
    }

    // Try to parse JSON response
    let data: any
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }

    // Handle error responses
    if (!response.ok) {
      const message = data?.error || data?.message || `HTTP ${response.status}`
      throw new ApiError(message, response.status, data)
    }

    return data as T
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof Error) {
      throw new ApiError(error.message, 0)
    }
    throw new ApiError('Unknown error occurred', 0)
  }
}

/**
 * API client methods
 */
export const api = {
  get: <T>(endpoint: string, params?: Record<string, any>) => {
    const queryString = params
      ? '?' + new URLSearchParams(params).toString()
      : ''
    return request<T>(endpoint + queryString, { method: 'GET' })
  },

  post: <T>(endpoint: string, body?: any) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(endpoint: string, body?: any) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
}
