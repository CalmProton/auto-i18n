import { getSetting } from './getSetting'
import type { H3Event } from 'h3'

/** Returns the configured ACCESS_KEY, or undefined if auth is disabled */
export async function getAccessKey(): Promise<string | undefined> {
  return getSetting('ACCESS_KEY')
}

/** Returns true if authentication is enabled */
export async function isAuthEnabled(): Promise<boolean> {
  const key = await getAccessKey()
  return !!(key && key.trim().length > 0)
}

/** Validates the access key from a request event. Returns true if valid or auth is disabled. */
export async function validateRequest(event: H3Event): Promise<boolean> {
  const configuredKey = await getAccessKey()
  if (!configuredKey || configuredKey.trim().length === 0) return true

  const provided =
    getHeader(event, 'x-access-key') ??
    getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '') ??
    getQuery(event).access_key as string | undefined

  return provided === configuredKey
}
