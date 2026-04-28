import { getSetting } from '../../../utils/getSetting'
import { db, schema } from '../../../db'
import { and, eq } from 'drizzle-orm'
import type { ForgeWorkflowResult } from '../types'

const { files } = schema

/**
 * Deliver translated files via webhook POST.
 * The payload contains all translated files so the receiving CI system
 * can commit them, create a branch, and open a PR in any git platform.
 */
export async function deliverViaWebhook(
  sessionId: string,
  senderId: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<ForgeWorkflowResult> {
  const webhookUrl = await getSetting('WEBHOOK_URL')
  if (!webhookUrl) throw new Error('WEBHOOK_URL not configured for webhook forge')

  const webhookSecret = await getSetting('WEBHOOK_SECRET')

  // Load all translated files
  const translatedFiles = await db.select().from(files)
    .where(and(
      eq(files.sessionId, sessionId),
      eq(files.fileType, 'translation'),
    ))

  const payload = {
    event: 'translation.completed',
    sessionId,
    senderId,
    sourceLocale,
    targetLocales,
    files: translatedFiles.map(f => ({
      type: f.contentType,
      locale: f.locale,
      path: f.filePath,
      format: f.format,
      content: f.content,
    })),
    timestamp: new Date().toISOString(),
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'auto-i18n/2.0',
  }
  if (webhookSecret) {
    headers['X-Webhook-Secret'] = webhookSecret
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webhook delivery failed: ${res.status} ${body}`)
  }

  return {
    forge: 'webhook',
    webhookUrl,
    skipped: false,
  }
}
