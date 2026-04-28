import { getAllSettings, maskValue } from '../utils/getSetting'

export default defineEventHandler(async () => {
  const all = await getAllSettings()
  // Mask sensitive values before returning
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    masked[key] = maskValue(key, value)
  }
  return { settings: masked }
})
