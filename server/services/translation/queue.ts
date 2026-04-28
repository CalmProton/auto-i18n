/**
 * StaggeredRequestQueue
 *
 * Limits concurrent AI API calls and staggers them to avoid rate limit errors.
 * Each call goes through enqueue() which returns a Promise resolving to the
 * task result once it has been executed.
 */
export class StaggeredRequestQueue {
  private queue: Array<() => Promise<void>> = []
  private running = 0
  private lastRequestAt = 0

  constructor(
    private readonly maxConcurrent: number = 5,
    private readonly staggerMs: number = 500,
  ) {}

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task())
        } catch (err) {
          reject(err)
        }
      })
      this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return
    const task = this.queue.shift()!
    this.running++

    // Stagger: wait until enough time has passed since the last request
    const now = Date.now()
    const elapsed = now - this.lastRequestAt
    if (elapsed < this.staggerMs && this.lastRequestAt > 0) {
      await sleep(this.staggerMs - elapsed)
    }
    this.lastRequestAt = Date.now()

    try {
      await task()
    } finally {
      this.running--
      this.drain()
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
