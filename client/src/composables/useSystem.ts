/**
 * useSystem Composable
 * Manages system statistics and configuration
 */

import { ref, computed } from 'vue'
import { api } from '../lib/api-client'
import type { SystemStats, LocalesResponse, DashboardOverview } from '../types/api'

const stats = ref<DashboardOverview | null>(null)
const systemStats = ref<SystemStats | null>(null)
const locales = ref<string[]>([])
const defaultLocale = ref<string>('en')
const loading = ref(false)
const error = ref<string | null>(null)

export function useSystem() {
  /**
   * Fetch dashboard overview statistics
   */
  async function fetchStats(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<DashboardOverview>('/api/dashboard/overview')
      stats.value = response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch dashboard stats'
      error.value = message
      console.error('Failed to fetch dashboard stats:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch system configuration and stats
   */
  async function fetchSystemStats(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<SystemStats>('/api/system/stats')
      systemStats.value = response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch system stats'
      error.value = message
      console.error('Failed to fetch system stats:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch supported locales
   */
  async function fetchLocales(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<LocalesResponse>('/api/locales')
      locales.value = response.locales
      defaultLocale.value = response.default
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch locales'
      error.value = message
      console.error('Failed to fetch locales:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Format bytes to human-readable string
   */
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  /**
   * Get configured providers
   */
  function getConfiguredProviders(): string[] {
    if (!systemStats.value) return []
    
    return Object.entries(systemStats.value.providers)
      .filter(([_, config]) => config.configured)
      .map(([name]) => name)
  }

  /**
   * Check if a provider is configured
   */
  function isProviderConfigured(provider: 'openai' | 'anthropic' | 'deepseek'): boolean {
    return systemStats.value?.providers[provider]?.configured ?? false
  }

  /**
   * Check if GitHub is configured
   */
  function isGitHubConfigured(): boolean {
    return systemStats.value?.github?.configured ?? false
  }

  /**
   * Initialize system data
   */
  async function initialize(): Promise<void> {
    await Promise.all([fetchStats(), fetchSystemStats(), fetchLocales()])
  }

  return {
    // State
    stats: computed(() => stats.value),
    systemStats: computed(() => systemStats.value),
    locales: computed(() => locales.value),
    defaultLocale: computed(() => defaultLocale.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),

    // Actions
    fetchStats,
    fetchSystemStats,
    fetchLocales,
    initialize,

    // Utilities
    formatBytes,
    getConfiguredProviders,
    isProviderConfigured,
    isGitHubConfigured,
  }
}
