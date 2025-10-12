/**
 * useGitHub Composable
 * Manages GitHub PR creation and status
 */

import { ref, computed } from 'vue'
import { api } from '../lib/api-client'
import type {
  GitHubSession,
  GitHubReadyResponse,
  FinalizeGitHubRequest,
} from '../types/api'
import { useToast } from './useToast'

const sessions = ref<GitHubSession[]>([])
const currentSession = ref<GitHubSession | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

export function useGitHub() {
  const toast = useToast()

  /**
   * Fetch sessions ready for GitHub PR
   */
  async function fetchReadySessions(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<GitHubReadyResponse>('/api/github/ready')
      sessions.value = response.sessions
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch GitHub ready sessions'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch GitHub ready sessions:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Check GitHub PR status for a sender
   */
  async function checkStatus(senderId: string): Promise<any> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<any>(`/api/github/status/${senderId}`)
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check GitHub status'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to check GitHub status:', err)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Finalize and create GitHub PR
   */
  async function finalizePR(
    senderId: string,
    request: FinalizeGitHubRequest
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<any>('/github/finalize', {
        senderId,
        ...request,
      })

      toast.success(
        'Pull Request Created',
        `PR has been created successfully${response.result?.pullRequest?.number ? ` (#${response.result.pullRequest.number})` : ''}`
      )
      
      // Refresh sessions list
      await fetchReadySessions()
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create pull request'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to create pull request:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Check if a session is ready for PR (all selected locales complete)
   */
  function isReadyForPR(session: GitHubSession, selectedLocales?: string[]): boolean {
    const locales = selectedLocales || session.completedLocales
    
    // All selected locales must be in the completed list
    return locales.every((locale) => session.completedLocales.includes(locale))
  }

  /**
   * Get available locales that are fully completed
   */
  function getAvailableLocales(session: GitHubSession): string[] {
    return session.completedLocales
  }

  /**
   * Get incomplete locales
   */
  function getIncompleteLocales(session: GitHubSession): string[] {
    return session.availableLocales.filter(
      (locale) => !session.completedLocales.includes(locale)
    )
  }

  /**
   * Refresh the sessions list
   */
  async function refresh(): Promise<void> {
    await fetchReadySessions()
  }

  /**
   * Find a session by senderId
   */
  function findSession(senderId: string): GitHubSession | undefined {
    return sessions.value.find((s) => s.senderId === senderId)
  }

  /**
   * Set current session
   */
  function setCurrentSession(session: GitHubSession | null): void {
    currentSession.value = session
  }

  return {
    // State
    sessions: computed(() => sessions.value),
    currentSession: computed(() => currentSession.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),

    // Actions
    fetchReadySessions,
    checkStatus,
    finalizePR,
    refresh,
    findSession,
    setCurrentSession,

    // Utilities
    isReadyForPR,
    getAvailableLocales,
    getIncompleteLocales,
  }
}
