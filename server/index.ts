import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import routes from './routes'
import { authMiddleware, authRoutes } from './middleware/auth'
import { startBatchPolling } from './services/batchPollingService'
import { initializeAll, closeAll, healthCheckAll } from './database'
import { startAllWorkers, stopAllWorkers } from './queues/workers'
import { scheduleCleanupJob, closeAllQueues } from './queues'
import { createScopedLogger } from './utils/logger'

const log = createScopedLogger('server')

// Initialize database connections
let dbInitialized = false

async function initializeServer() {
  if (dbInitialized) return
  
  try {
    log.info('Initializing database connections...')
    await initializeAll()
    dbInitialized = true
    log.info('Database connections initialized')
    
    // Start queue workers
    log.info('Starting queue workers...')
    startAllWorkers()
    
    // Schedule cleanup jobs
    await scheduleCleanupJob()
    
    log.info('Server initialization complete')
  } catch (error) {
    log.error('Failed to initialize server', { error })
    // Don't throw - allow server to start even if DB is down
    // Health check will report the issue
  }
}

// Graceful shutdown handler
async function shutdown() {
  log.info('Shutting down server...')
  
  try {
    await stopAllWorkers()
    await closeAllQueues()
    await closeAll()
    log.info('Server shutdown complete')
  } catch (error) {
    log.error('Error during shutdown', { error })
  }
  
  process.exit(0)
}

// Register shutdown handlers
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const app = new Elysia()

// Enable CORS for the Vue client
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
}))

// Check if we're in production with built frontend
const clientDistPath = join(import.meta.dir, '..', 'client', 'dist')
const hasBuiltClient = existsSync(clientDistPath)

// Root endpoint for development (when no built client)
if (!hasBuiltClient) {
  app.get('/', () => 'Auto-i18n File Processing Server - Run "bun run client" for the dashboard')
}

// Mount auth routes (not protected)
app.use(authRoutes)

// Apply authentication middleware to all other routes
app.use(authMiddleware)

// Mount all routes (protected by auth middleware)
app.use(routes)

// Serve static files from client/dist in production
if (hasBuiltClient) {
  // Serve static assets (js, css, images, etc.)
  app.get('/assets/*', async ({ params }) => {
    const filePath = join(clientDistPath, 'assets', params['*'])
    const file = Bun.file(filePath)
    if (await file.exists()) {
      return new Response(file)
    }
    return new Response('Not Found', { status: 404 })
  })

  // Serve other static files (favicon, etc.)
  app.get('/*', async ({ params, path }) => {
    // Skip API routes
    if (path.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 })
    }

    // Try to serve the exact file
    const filePath = join(clientDistPath, params['*'] || '')
    const file = Bun.file(filePath)
    if (await file.exists() && !(await file.stat())?.isDirectory?.()) {
      return new Response(file)
    }

    // Fallback to index.html for SPA routing
    const indexFile = Bun.file(join(clientDistPath, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    return new Response('Not Found', { status: 404 })
  })

  console.log('📦 Serving static files from client/dist')
}

// Enhanced health check with database status
app.get('/health', async () => {
  const dbHealth = await healthCheckAll()
  return {
    status: dbHealth.overall ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbHealth.database,
    redis: dbHealth.redis,
  }
})

const PORT = process.env.PORT || 3000

// Initialize server and start listening
initializeServer().then(() => {
  app.listen(PORT)
  
  log.info(`🦊 Auto-i18n server is running at http://localhost:${PORT}`)
  
  // Start background batch polling service (legacy - will be replaced by queue workers)
  startBatchPolling()
}).catch((error) => {
  log.error('Failed to start server', { error })
  process.exit(1)
})
