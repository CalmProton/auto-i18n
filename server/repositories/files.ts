import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

export type DbFile = InferSelectModel<typeof schema.files>
export type NewDbFile = InferInsertModel<typeof schema.files>

export async function getFilesBySession(sessionId: string): Promise<DbFile[]> {
  return db.select().from(schema.files).where(eq(schema.files.sessionId, sessionId))
}

export async function getFilesByType(sessionId: string, fileType: string): Promise<DbFile[]> {
  return db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.sessionId, sessionId), eq(schema.files.fileType, fileType)))
}

export async function getFilesByLocale(sessionId: string, locale: string): Promise<DbFile[]> {
  return db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.sessionId, sessionId), eq(schema.files.locale, locale)))
}

export async function getFilesByTypeAndLocale(
  sessionId: string,
  fileType: string,
  locale: string,
): Promise<DbFile[]> {
  return db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.sessionId, sessionId),
        eq(schema.files.fileType, fileType),
        eq(schema.files.locale, locale),
      ),
    )
}

export async function createFile(data: NewDbFile): Promise<DbFile> {
  const [row] = await db.insert(schema.files).values(data).returning()
  return row!
}

/** Upsert on (sessionId, fileType, locale, filePath) */
export async function upsertFile(data: NewDbFile): Promise<DbFile> {
  const [row] = await db
    .insert(schema.files)
    .values(data)
    .onConflictDoUpdate({
      target: [schema.files.sessionId, schema.files.fileType, schema.files.locale, schema.files.filePath],
      set: { content: data.content, createdAt: new Date().toISOString() },
    })
    .returning()
  return row!
}

export async function deleteFilesBySession(sessionId: string): Promise<void> {
  await db.delete(schema.files).where(eq(schema.files.sessionId, sessionId))
}
