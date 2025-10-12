import { promises as fs } from 'fs'
import path from 'path'

interface ApiResponseLog {
  timestamp: string
  provider: string
  model: string
  requestType: 'markdown' | 'json'
  requestId?: string
  senderId: string
  sourceLocale: string
  targetLocale: string
  filePath: string
  request?: {
    messages?: any[]
    model?: string
    temperature?: number
    max_tokens?: number
    max_completion_tokens?: number
    response_format?: any
  }
  response: any
  error?: any
  success: boolean
}

class ApiResponseLogger {
  private logFile: string
  private sessionId: string

  constructor() {
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-')
    this.logFile = path.join(process.cwd(), 'tmp', 'logs', `api-responses-${this.sessionId}.json`)
  }

  async logResponse(log: ApiResponseLog) {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.logFile), { recursive: true })

      // Read existing logs
      let logs: ApiResponseLog[] = []
      try {
        const existingContent = await fs.readFile(this.logFile, 'utf-8')
        logs = JSON.parse(existingContent)
      } catch (error) {
        // File doesn't exist yet, start with empty array
      }

      // Add new log
      logs.push(log)

      // Write back to file
      await fs.writeFile(this.logFile, JSON.stringify(logs, null, 2))
    } catch (error) {
      console.error('Failed to write API response log:', error)
    }
  }

  getLogFile(): string {
    return this.logFile
  }
}

// Global instance
const apiLogger = new ApiResponseLogger()

export async function logApiResponse(log: ApiResponseLog) {
  await apiLogger.logResponse(log)
}

export function getApiLogFile(): string {
  return apiLogger.getLogFile()
}