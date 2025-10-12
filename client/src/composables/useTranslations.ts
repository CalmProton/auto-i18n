/**
 * useTranslations Composable
 * Manages translation sessions and status
 */

import { ref, computed } from 'vue'
import { api } from '../lib/api-client'
import type {
  TranslationSession,
  TranslationsResponse,
  FileInfo,
} from '../types/api'
import { useToast } from './useToast'

const translations = ref<TranslationSession[]>([])
const currentTranslation = ref<TranslationSession | null>(null)
const currentFiles = ref<FileInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const pagination = ref({
  total: 0,
  limit: 50,
  offset: 0,
  hasMore: false,
})

export function useTranslations() {
  const toast = useToast()

  /**
   * Fetch all translation sessions
   */
  async function fetchTranslations(options?: {
    senderId?: string
    limit?: number
    offset?: number
  }): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const params: Record<string, any> = {
        limit: options?.limit || pagination.value.limit,
        offset: options?.offset || 0,
      }

      if (options?.senderId) {
        params.senderId = options.senderId
      }

      const response = await api.get<TranslationsResponse>('/api/translations', params)
      translations.value = response.translations
      pagination.value = response.pagination
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch translations'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch translations:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch translation status for a specific sender
   */
  async function fetchTranslationStatus(senderId: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<TranslationSession>(`/api/translations/${senderId}/status`)
      currentTranslation.value = response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch translation status'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch translation status:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch translation files for a specific locale and type
   */
  async function fetchTranslationFiles(
    senderId: string,
    locale: string,
    type: 'content' | 'global' | 'page'
  ): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<{ files: FileInfo[] }>(
        `/api/translations/${senderId}/${locale}/${type}`
      )
      currentFiles.value = response.files
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch translation files'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch translation files:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Check if a translation session is complete
   */
  function isSessionComplete(session: TranslationSession): boolean {
    return session.summary.percentage === 100
  }

  /**
   * Get missing translations for a session
   */
  function getMissingTranslations(session: TranslationSession): Array<{
    locale: string
    missing: number
  }> {
    return session.targetLocales
      .map((locale) => {
        const status = session.matrix[locale]
        if (!status) return null
        
        const missing =
          status.content.expected - status.content.count +
          status.global.expected - status.global.count +
          status.page.expected - status.page.count
        
        return missing > 0 ? { locale, missing } : null
      })
      .filter((item): item is { locale: string; missing: number } => item !== null)
  }

  /**
   * Get completed locales for a session
   */
  function getCompletedLocales(session: TranslationSession): string[] {
    return session.targetLocales.filter((locale) => {
      const status = session.matrix[locale]
      return status && status.percentage === 100
    })
  }

  /**
   * Refresh the translations list
   */
  async function refresh(): Promise<void> {
    await fetchTranslations({ offset: pagination.value.offset })
  }

  /**
   * Load next page of translations
   */
  async function loadMore(): Promise<void> {
    if (!pagination.value.hasMore) return
    await fetchTranslations({ offset: pagination.value.offset + pagination.value.limit })
  }

  /**
   * Find a translation session by senderId
   */
  function findTranslation(senderId: string): TranslationSession | undefined {
    return translations.value.find((t) => t.senderId === senderId)
  }

  return {
    // State
    translations: computed(() => translations.value),
    currentTranslation: computed(() => currentTranslation.value),
    currentFiles: computed(() => currentFiles.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    pagination: computed(() => pagination.value),

    // Actions
    fetchTranslations,
    fetchTranslationStatus,
    fetchTranslationFiles,
    refresh,
    loadMore,
    findTranslation,

    // Utilities
    isSessionComplete,
    getMissingTranslations,
    getCompletedLocales,
  }
}
