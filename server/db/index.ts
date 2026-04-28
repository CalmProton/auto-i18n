export { getDb as _getDb } from './sqlite'
import { getDb } from './sqlite'
import * as schema from './schema'

// Proxy so consumers can `import { db }` at module load time without triggering
// SQLite open before the bootstrap plugin has run.
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>
    const value = real[prop as string]
    return typeof value === 'function' ? (value as Function).bind(real) : value
  },
})

export { schema }
