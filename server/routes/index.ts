import { Elysia } from 'elysia'
import contentRoutes from './content'
import globalTranslationRoutes from './global'
import pageTranslationRoutes from './page'
import githubRoutes from './github'
import batchRoutes from './batch'
import dashboardRoutes from './dashboard'
import changesRoutes from './changes'
import { pipelineRoutes } from './pipeline'
import { sseRoutes } from './sse'

const routes = new Elysia()

// Route modules
routes.use(contentRoutes)
routes.use(globalTranslationRoutes)
routes.use(pageTranslationRoutes)
routes.use(batchRoutes)
routes.use(githubRoutes)
routes.use(dashboardRoutes)
routes.use(changesRoutes)
routes.use(pipelineRoutes)
routes.use(sseRoutes)

export default routes