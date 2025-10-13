import { createScopedLogger } from './logger'
import type { JsonDelta } from '../types'

const log = createScopedLogger('utils:deltaExtractor')

/**
 * Extracts the delta (differences) between two JSON objects
 * Returns added, modified, and deleted keys
 */
export function extractJsonDelta(
  oldContent: Record<string, any>,
  newContent: Record<string, any>,
  prefix: string = ''
): JsonDelta {
  const delta: JsonDelta = {
    added: {},
    modified: {},
    deleted: []
  }

  // Find added and modified keys
  for (const [key, newValue] of Object.entries(newContent)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const oldValue = oldContent[key]

    if (!(key in oldContent)) {
      // Key is added
      delta.added[key] = newValue
      log.debug('Key added', { key: fullKey })
    } else if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
      // Recursively check nested objects
      if (typeof oldValue === 'object' && oldValue !== null && !Array.isArray(oldValue)) {
        const nestedDelta = extractJsonDelta(oldValue, newValue, fullKey)
        
        // Merge nested deltas
        if (Object.keys(nestedDelta.added).length > 0) {
          delta.added[key] = { ...(delta.added[key] || {}), ...nestedDelta.added }
        }
        if (Object.keys(nestedDelta.modified).length > 0) {
          delta.modified[key] = { ...(delta.modified[key] || {}), ...nestedDelta.modified }
        }
        if (nestedDelta.deleted.length > 0) {
          delta.deleted.push(...nestedDelta.deleted.map(d => `${key}.${d}`))
        }
      } else {
        // Type changed from non-object to object
        delta.modified[key] = newValue
        log.debug('Key type changed to object', { key: fullKey })
      }
    } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      // Value is modified
      delta.modified[key] = newValue
      log.debug('Key modified', { key: fullKey })
    }
  }

  // Find deleted keys
  for (const key of Object.keys(oldContent)) {
    if (!(key in newContent)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      delta.deleted.push(key)
      log.debug('Key deleted', { key: fullKey })
    }
  }

  return delta
}

/**
 * Parse JSON content safely
 */
export function parseJsonSafe(content: string): Record<string, any> | null {
  try {
    return JSON.parse(content)
  } catch (error) {
    log.error('Failed to parse JSON', { error })
    return null
  }
}

/**
 * Extract line-by-line delta for markdown files
 * Returns changed lines with their line numbers
 */
export interface MarkdownDelta {
  changes: Array<{
    lineNumber: number
    oldLine: string
    newLine: string
    type: 'added' | 'modified' | 'deleted'
  }>
}

export function extractMarkdownDelta(
  oldContent: string,
  newContent: string
): MarkdownDelta {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const changes: MarkdownDelta['changes'] = []

  const maxLength = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLength; i++) {
    const oldLine = oldLines[i] ?? ''
    const newLine = newLines[i] ?? ''

    if (i >= oldLines.length) {
      // Line was added
      changes.push({
        lineNumber: i + 1,
        oldLine: '',
        newLine,
        type: 'added'
      })
    } else if (i >= newLines.length) {
      // Line was deleted
      changes.push({
        lineNumber: i + 1,
        oldLine,
        newLine: '',
        type: 'deleted'
      })
    } else if (oldLine !== newLine) {
      // Line was modified
      changes.push({
        lineNumber: i + 1,
        oldLine,
        newLine,
        type: 'modified'
      })
    }
  }

  log.debug('Extracted markdown delta', {
    totalChanges: changes.length,
    added: changes.filter(c => c.type === 'added').length,
    modified: changes.filter(c => c.type === 'modified').length,
    deleted: changes.filter(c => c.type === 'deleted').length
  })

  return { changes }
}

/**
 * Merge a delta back into a full JSON object
 * Used after translation to merge translated deltas into existing translations
 */
export function mergeDelta(
  existing: Record<string, any>,
  delta: JsonDelta
): Record<string, any> {
  const result = { ...existing }

  // Add new keys
  for (const [key, value] of Object.entries(delta.added)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively merge nested objects
      result[key] = { ...(result[key] || {}), ...value }
    } else {
      result[key] = value
    }
  }

  // Update modified keys
  for (const [key, value] of Object.entries(delta.modified)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively merge nested objects
      result[key] = { ...(result[key] || {}), ...value }
    } else {
      result[key] = value
    }
  }

  // Remove deleted keys
  for (const key of delta.deleted) {
    // Handle nested keys (e.g., "parent.child")
    const parts = key.split('.')
    if (parts.length === 1) {
      delete result[key]
    } else {
      // Navigate to parent and delete child
      let current = result
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) break
        current = current[parts[i]]
      }
      if (current && typeof current === 'object') {
        delete current[parts[parts.length - 1]]
      }
    }
  }

  return result
}

/**
 * Check if a delta is empty (no changes)
 */
export function isDeltaEmpty(delta: JsonDelta): boolean {
  return (
    Object.keys(delta.added).length === 0 &&
    Object.keys(delta.modified).length === 0 &&
    delta.deleted.length === 0
  )
}

/**
 * Count total changes in a delta
 */
export function countDeltaChanges(delta: JsonDelta): number {
  return (
    Object.keys(delta.added).length +
    Object.keys(delta.modified).length +
    delta.deleted.length
  )
}

/**
 * Flatten nested delta structure for translation
 * Converts nested objects to dot notation for easier handling
 */
export function flattenDelta(delta: JsonDelta): JsonDelta {
  const flattened: JsonDelta = {
    added: {},
    modified: {},
    deleted: [...delta.deleted]
  }

  function flattenObject(obj: Record<string, any>, prefix: string = ''): Record<string, any> {
    const result: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, flattenObject(value, newKey))
      } else {
        result[newKey] = value
      }
    }
    
    return result
  }

  flattened.added = flattenObject(delta.added)
  flattened.modified = flattenObject(delta.modified)

  return flattened
}

/**
 * Unflatten dot notation back to nested structure
 */
export function unflattenDelta(delta: JsonDelta): JsonDelta {
  const unflattened: JsonDelta = {
    added: {},
    modified: {},
    deleted: [...delta.deleted]
  }

  function unflattenObject(flat: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(flat)) {
      const parts = key.split('.')
      let current = result
      
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) {
          current[parts[i]] = {}
        }
        current = current[parts[i]]
      }
      
      current[parts[parts.length - 1]] = value
    }
    
    return result
  }

  unflattened.added = unflattenObject(delta.added)
  unflattened.modified = unflattenObject(delta.modified)

  return unflattened
}
