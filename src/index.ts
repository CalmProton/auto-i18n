import { Hono } from 'hono'
import routes from './routes'

const app = new Hono()

// Root endpoint
app.get('/', (c) => {
  return c.text('Auto-i18n File Processing Server')
})

// Mount all routes
app.route('/', routes)

export default app
