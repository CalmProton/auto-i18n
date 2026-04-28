import type { ForgeWorkflowResult } from '../types'

/**
 * No-op forge. Translations stored in DB.
 * CI can retrieve them via GET /api/sessions/:id/output
 */
export async function deliverNone(_sessionId: string): Promise<ForgeWorkflowResult> {
  return { forge: 'none', skipped: true }
}
