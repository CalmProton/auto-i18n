import { Elysia } from 'elysia'
import routes from './routes'

const app = new Elysia()

// Root endpoint
app.get('/', () => {
  return 'Auto-i18n File Processing Server'
})

// Mount all routes
app.use(routes)

const PORT = process.env.PORT || 3001

app.listen(PORT)

console.log(`🦊 Auto-i18n server is running at http://localhost:${PORT}`)
