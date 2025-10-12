/**
 * useKeyboardShortcuts Composable
 * Manages keyboard shortcuts for power users
 */

import { onMounted, onUnmounted } from 'vue'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  handler: () => void
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  function handleKeyPress(event: KeyboardEvent) {
    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }

    for (const shortcut of shortcuts) {
      const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
      const ctrlMatches = shortcut.ctrl === undefined || shortcut.ctrl === event.ctrlKey
      const shiftMatches = shortcut.shift === undefined || shortcut.shift === event.shiftKey
      const altMatches = shortcut.alt === undefined || shortcut.alt === event.altKey
      const metaMatches = shortcut.meta === undefined || shortcut.meta === event.metaKey

      if (keyMatches && ctrlMatches && shiftMatches && altMatches && metaMatches) {
        event.preventDefault()
        shortcut.handler()
        break
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyPress)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyPress)
  })

  function getShortcutDisplay(shortcut: KeyboardShortcut): string {
    const parts: string[] = []
    
    if (shortcut.ctrl) parts.push('Ctrl')
    if (shortcut.shift) parts.push('Shift')
    if (shortcut.alt) parts.push('Alt')
    if (shortcut.meta) parts.push('Cmd')
    parts.push(shortcut.key.toUpperCase())
    
    return parts.join('+')
  }

  return {
    shortcuts,
    getShortcutDisplay
  }
}
