import { Hono } from 'hono'
import contentRoutes from './content'
import globalTranslationRoutes from './global'
import pageTranslationRoutes from './page'

const routes = new Hono()

// Route modules
routes.route('/translate/content', contentRoutes)
routes.route('/translate/global', globalTranslationRoutes)
routes.route('/translate/page', pageTranslationRoutes)

export default routes