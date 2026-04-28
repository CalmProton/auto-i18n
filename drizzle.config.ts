import { defineConfig } from 'drizzle-kit'
import { resolve } from 'node:path'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: resolve(process.cwd(), 'tmp', 'auto-i18n.sqlite'),
  },
})
