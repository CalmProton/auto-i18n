import { db, schema } from '../../db'
import { desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  const gitJobs = await db
    .select()
    .from(schema.gitJobs)
    .orderBy(desc(schema.gitJobs.createdAt))
    .limit(limit)
    .offset(offset)

  const total = (await db.select().from(schema.gitJobs)).length

  return { gitJobs, total, limit, offset }
})
