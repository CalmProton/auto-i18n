import { createScopedLogger, type Logger } from '../../utils/logger'

const log = createScopedLogger('translation:request-queue')

export interface QueuedRequest<T, R> {
  id: string
  request: T
  resolve: (value: R) => void
  reject: (error: Error) => void
  timestamp: number
}

export interface RequestQueueOptions {
  staggerDelayMs?: number
  maxConcurrentRequests?: number
  requestTimeoutMs?: number
}

/**
 * A request queue that sends requests with staggered timing to avoid overwhelming APIs
 * while still allowing concurrent processing without waiting for each response.
 */
export class StaggeredRequestQueue<T, R> {
  private queue: QueuedRequest<T, R>[] = []
  private activeRequests = new Map<string, QueuedRequest<T, R>>()
  private lastRequestTime = 0
  private isProcessing = false
  private requestCounter = 0

  private readonly staggerDelayMs: number
  private readonly maxConcurrentRequests: number
  private readonly requestTimeoutMs: number
  private readonly log: Logger

  constructor(
    private readonly processor: (request: T) => Promise<R>,
    options: RequestQueueOptions = {}
  ) {
    this.staggerDelayMs = options.staggerDelayMs ?? 1000 // 1 second default
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 10
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000 // 1 minute default
    this.log = log.child({ 
      staggerDelayMs: this.staggerDelayMs,
      maxConcurrentRequests: this.maxConcurrentRequests 
    })
  }

  /**
   * Add a request to the queue and return a promise that resolves when the request completes
   */
  async enqueue(request: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const id = `req_${++this.requestCounter}_${Date.now()}`
      const queuedRequest: QueuedRequest<T, R> = {
        id,
        request,
        resolve,
        reject,
        timestamp: Date.now()
      }

      this.queue.push(queuedRequest)
      this.log.debug('Request enqueued', { 
        requestId: id, 
        queueLength: this.queue.length,
        activeRequests: this.activeRequests.size
      })

      if (!this.isProcessing) {
        this.startProcessing()
      }
    })
  }

  /**
   * Get current queue statistics
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests.size,
      isProcessing: this.isProcessing,
      lastRequestTime: this.lastRequestTime
    }
  }

  private startProcessing() {
    if (this.isProcessing) {
      return
    }

    this.isProcessing = true
    this.log.info('Starting request queue processing')
    this.processNext()
  }

  private async processNext() {
    while (this.isProcessing && (this.queue.length > 0 || this.activeRequests.size > 0)) {
      // Process completed requests and remove them from active map
      await this.cleanupCompletedRequests()

      // Check if we can send a new request
      if (this.canSendNewRequest()) {
        const queuedRequest = this.queue.shift()
        if (queuedRequest) {
          this.sendRequest(queuedRequest)
        }
      }

      // Wait a bit before checking again
      await this.sleep(100)
    }

    this.isProcessing = false
    this.log.info('Request queue processing stopped')
  }

  private canSendNewRequest(): boolean {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    const hasCapacity = this.activeRequests.size < this.maxConcurrentRequests
    const canStagger = timeSinceLastRequest >= this.staggerDelayMs || this.activeRequests.size === 0

    return hasCapacity && canStagger && this.queue.length > 0
  }

  private async sendRequest(queuedRequest: QueuedRequest<T, R>) {
    const now = Date.now()
    this.lastRequestTime = now
    this.activeRequests.set(queuedRequest.id, queuedRequest)

    this.log.info('Sending staggered request', { 
      requestId: queuedRequest.id,
      activeRequests: this.activeRequests.size,
      queueRemaining: this.queue.length
    })

    // Set up timeout for the request
    const timeoutHandle = setTimeout(() => {
      const request = this.activeRequests.get(queuedRequest.id)
      if (request) {
        this.activeRequests.delete(queuedRequest.id)
        const error = new Error(`Request timeout after ${this.requestTimeoutMs}ms`)
        this.log.error('Request timed out', { 
          requestId: queuedRequest.id,
          timeoutMs: this.requestTimeoutMs
        })
        request.reject(error)
      }
    }, this.requestTimeoutMs)

    try {
      // Process the request asynchronously without awaiting here
      this.processor(queuedRequest.request)
        .then((result) => {
          clearTimeout(timeoutHandle)
          const request = this.activeRequests.get(queuedRequest.id)
          if (request) {
            this.activeRequests.delete(queuedRequest.id)
            this.log.info('Request completed successfully', { 
              requestId: queuedRequest.id,
              duration: Date.now() - queuedRequest.timestamp
            })
            request.resolve(result)
          }
        })
        .catch((error) => {
          clearTimeout(timeoutHandle)
          const request = this.activeRequests.get(queuedRequest.id)
          if (request) {
            this.activeRequests.delete(queuedRequest.id)
            this.log.error('Request failed', { 
              requestId: queuedRequest.id,
              duration: Date.now() - queuedRequest.timestamp,
              error
            })
            request.reject(error)
          }
        })
    } catch (error) {
      clearTimeout(timeoutHandle)
      this.activeRequests.delete(queuedRequest.id)
      this.log.error('Request processing threw synchronously', { 
        requestId: queuedRequest.id,
        error
      })
      queuedRequest.reject(error as Error)
    }
  }

  private async cleanupCompletedRequests() {
    // This method allows the processing loop to continue even if some requests are still pending
    // The actual cleanup happens in the success/error callbacks of sendRequest
    return Promise.resolve()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}