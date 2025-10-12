import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import routes from './routes'
import { authMiddleware, authRoutes } from './middleware/auth'

const app = new Elysia()

// Enable CORS for the Vue client
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
}))

// Root endpoint
app.get('/', () => {
  return 'Auto-i18n File Processing Server'
})

// Mount auth routes (not protected)
app.use(authRoutes)

// Apply authentication middleware to all other routes
app.use(authMiddleware)

// Mount all routes (protected by auth middleware)
app.use(routes)

const PORT = process.env.PORT || 3000

app.listen(PORT)

console.log(`🦊 Auto-i18n server is running at http://localhost:${PORT}`)
