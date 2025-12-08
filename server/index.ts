import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import routes from './routes'
import { authMiddleware, authRoutes } from './middleware/auth'
import { startBatchPolling } from './services/batchPollingService'

const app = new Elysia()

// Enable CORS for the Vue client
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
}))

// Check if we're in production with built frontend
const clientDistPath = join(import.meta.dir, '..', 'client', 'dist')
const hasBuiltClient = existsSync(clientDistPath)

// Health check endpoint (not protected)
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

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

const PORT = process.env.PORT || 3000

app.listen(PORT)

console.log(`🦊 Auto-i18n server is running at http://localhost:${PORT}`)

// Start background batch polling service
startBatchPolling()
