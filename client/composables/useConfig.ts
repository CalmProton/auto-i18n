/**
 * useConfig Composable
 * Manages system configuration state and API interactions
 */

import { ref, computed, reactive } from 'vue'
import { api } from '../lib/api-client'
import { useToast } from './useToast'

// Types
export type TranslationProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter'

export interface ConfigValue {
  key: string
  value: unknown
  isSensitive: boolean
  maskedPreview?: string
  updatedAt: string
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextLength?: number
  description?: string
  pricing?: {
    prompt?: string
    completion?: string
  }
}

export interface ConfigStatus {
  mockModeEnabled: boolean
  currentProvider: TranslationProvider | null
  defaultModel: string | null
  configuredProviders: {
    openai: boolean
    anthropic: boolean
    deepseek: boolean
    openrouter: boolean
  }
}

export interface ConfigState {
  general: ConfigValue[]
  provider: ConfigValue[]
  openai: ConfigValue[]
  anthropic: ConfigValue[]
  deepseek: ConfigValue[]
  openrouter: ConfigValue[]
}

// Config keys
export const ConfigKeys = {
  MOCK_TRANSLATIONS: 'mock_translations',
  TRANSLATION_PROVIDER: 'translation_provider',
  DEFAULT_MODEL: 'default_model',
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_MODEL: 'openai_model',
  ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTHROPIC_MODEL: 'anthropic_model',
  DEEPSEEK_API_KEY: 'deepseek_api_key',
  DEEPSEEK_MODEL: 'deepseek_model',
  OPENROUTER_API_KEY: 'openrouter_api_key',
  OPENROUTER_MODEL: 'openrouter_model',
} as const

// Shared reactive state
const configs = ref<ConfigValue[]>([])
const groupedConfigs = ref<ConfigState>({
  general: [],
  provider: [],
  openai: [],
  anthropic: [],
  deepseek: [],
  openrouter: [],
})
const status = ref<ConfigStatus | null>(null)
const models = reactive<Record<TranslationProvider, ModelInfo[]>>({
  openai: [],
  anthropic: [],
  deepseek: [],
  openrouter: [],
})
const loading = ref(false)
const loadingModels = ref<Record<TranslationProvider, boolean>>({
  openai: false,
  anthropic: false,
  deepseek: false,
  openrouter: false,
})
const error = ref<string | null>(null)

export function useConfig() {
  const toast = useToast()

  /**
   * Fetch all configuration values
   */
  async function fetchConfigs(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await api.get<{
        success: boolean
        configs: ConfigValue[]
        grouped: ConfigState
        error?: string
      }>('/api/config')

      if (response.success) {
        configs.value = response.configs
        groupedConfigs.value = response.grouped
      } else {
        throw new Error(response.error || 'Failed to fetch configuration')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch configuration'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to fetch config:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch configuration status
   */
  async function fetchStatus(): Promise<void> {
    try {
      const response = await api.get<{
        success: boolean
        status: ConfigStatus
        error?: string
      }>('/api/config/status')

      if (response.success) {
        status.value = response.status
      }
    } catch (err) {
      console.error('Failed to fetch config status:', err)
    }
  }

  /**
   * Get a single config value
   */
  function getConfigValue<T = unknown>(key: string): T | null {
    const config = configs.value.find(c => c.key === key)
    if (!config) return null
    return config.value as T
  }

  /**
   * Set a configuration value
   */
  async function setConfig(
    key: string,
    value: unknown,
    options?: { description?: string; isSensitive?: boolean }
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await api.put<{
        success: boolean
        config: ConfigValue
        error?: string
      }>(`/api/config/${key}`, {
        value,
        description: options?.description,
        isSensitive: options?.isSensitive,
      })

      if (response.success) {
        // Update local state
        const index = configs.value.findIndex(c => c.key === key)
        if (index >= 0) {
          configs.value[index] = response.config
        } else {
          configs.value.push(response.config)
        }
        
        toast.success('Saved', `Configuration "${key}" updated successfully`)
        
        // Refresh status after update
        await fetchStatus()
        
        return true
      } else {
        throw new Error(response.error || 'Failed to save configuration')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to set config:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Set multiple configuration values at once
   */
  async function setConfigBatch(
    configUpdates: Array<{
      key: string
      value: unknown
      description?: string
      isSensitive?: boolean
    }>
  ): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<{
        success: boolean
        configs: ConfigValue[]
        errors?: Array<{ key: string; error: string }>
      }>('/api/config/batch', { configs: configUpdates })

      if (response.success) {
        // Refresh all configs
        await fetchConfigs()
        toast.success('Saved', 'Configuration updated successfully')
        return true
      } else if (response.errors && response.errors.length > 0) {
        const failedKeys = response.errors.map(e => e.key).join(', ')
        throw new Error(`Failed to save: ${failedKeys}`)
      } else {
        throw new Error('Failed to save configuration')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration'
      error.value = message
      toast.error('Error', message)
      console.error('Failed to batch set config:', err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete a configuration value
   */
  async function deleteConfig(key: string): Promise<boolean> {
    loading.value = true

    try {
      const response = await api.delete<{
        success: boolean
        error?: string
      }>(`/api/config/${key}`)

      if (response.success) {
        // Remove from local state
        configs.value = configs.value.filter(c => c.key !== key)
        toast.success('Deleted', `Configuration "${key}" removed`)
        
        // Refresh status
        await fetchStatus()
        
        return true
      } else {
        throw new Error(response.error || 'Failed to delete configuration')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete configuration'
      error.value = message
      toast.error('Error', message)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch available models for a provider
   */
  async function fetchModels(
    provider: TranslationProvider,
    apiKey?: string
  ): Promise<ModelInfo[]> {
    loadingModels.value[provider] = true

    try {
      const params = apiKey ? { apiKey } : undefined
      const response = await api.get<{
        success: boolean
        models: ModelInfo[]
        provider: string
        error?: string
      }>(`/api/config/models/${provider}`, params)

      if (response.success) {
        models[provider] = response.models
        return response.models
      } else {
        // Don't throw on model fetch failure - use empty list
        console.warn(`Failed to fetch ${provider} models:`, response.error)
        return models[provider] // Return existing models if any
      }
    } catch (err) {
      console.error(`Failed to fetch ${provider} models:`, err)
      return models[provider] // Return existing models
    } finally {
      loadingModels.value[provider] = false
    }
  }

  /**
   * Fetch models for all providers
   */
  async function fetchAllModels(): Promise<void> {
    await Promise.all([
      fetchModels('openai'),
      fetchModels('anthropic'),
      fetchModels('deepseek'),
      fetchModels('openrouter'),
    ])
  }

  /**
   * Toggle mock mode
   */
  async function toggleMockMode(enabled: boolean): Promise<boolean> {
    return setConfig(ConfigKeys.MOCK_TRANSLATIONS, enabled, {
      description: 'Enable mock translation mode (no API calls)',
    })
  }

  /**
   * Set the translation provider
   */
  async function setProvider(provider: TranslationProvider): Promise<boolean> {
    return setConfig(ConfigKeys.TRANSLATION_PROVIDER, provider, {
      description: 'Default translation provider',
    })
  }

  /**
   * Set provider API key
   */
  async function setProviderApiKey(
    provider: TranslationProvider,
    apiKey: string
  ): Promise<boolean> {
    const keyMap: Record<TranslationProvider, string> = {
      openai: ConfigKeys.OPENAI_API_KEY,
      anthropic: ConfigKeys.ANTHROPIC_API_KEY,
      deepseek: ConfigKeys.DEEPSEEK_API_KEY,
      openrouter: ConfigKeys.OPENROUTER_API_KEY,
    }
    
    return setConfig(keyMap[provider], apiKey, {
      description: `${provider} API key`,
      isSensitive: true,
    })
  }

  /**
   * Set provider model
   */
  async function setProviderModel(
    provider: TranslationProvider,
    model: string
  ): Promise<boolean> {
    const keyMap: Record<TranslationProvider, string> = {
      openai: ConfigKeys.OPENAI_MODEL,
      anthropic: ConfigKeys.ANTHROPIC_MODEL,
      deepseek: ConfigKeys.DEEPSEEK_MODEL,
      openrouter: ConfigKeys.OPENROUTER_MODEL,
    }
    
    return setConfig(keyMap[provider], model, {
      description: `${provider} model`,
    })
  }

  // Computed helpers
  const mockModeEnabled = computed(() => status.value?.mockModeEnabled ?? false)
  const currentProvider = computed(() => status.value?.currentProvider ?? null)
  const defaultModel = computed(() => status.value?.defaultModel ?? null)
  const configuredProviders = computed(() => status.value?.configuredProviders ?? {
    openai: false,
    anthropic: false,
    deepseek: false,
    openrouter: false,
  })

  return {
    // State
    configs,
    groupedConfigs,
    status,
    models,
    loading,
    loadingModels,
    error,
    
    // Computed
    mockModeEnabled,
    currentProvider,
    defaultModel,
    configuredProviders,
    
    // Methods
    fetchConfigs,
    fetchStatus,
    getConfigValue,
    setConfig,
    setConfigBatch,
    deleteConfig,
    fetchModels,
    fetchAllModels,
    toggleMockMode,
    setProvider,
    setProviderApiKey,
    setProviderModel,
    
    // Constants
    ConfigKeys,
  }
}
