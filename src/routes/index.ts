import { Elysia } from 'elysia'
import contentRoutes from './content'
import globalTranslationRoutes from './global'
import pageTranslationRoutes from './page'
import githubRoutes from './github'
import batchRoutes from './batch'

const routes = new Elysia()

// Route modules
routes.use(contentRoutes)
routes.use(globalTranslationRoutes)
routes.use(pageTranslationRoutes)
routes.use(batchRoutes)
routes.use(githubRoutes)
// will add "changes" route later to translate changes and not full content

export default routes