import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import routes from './routes'

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

// Mount all routes
app.use(routes)

const PORT = process.env.PORT || 3001

app.listen(PORT)

console.log(`🦊 Auto-i18n server is running at http://localhost:${PORT}`)
