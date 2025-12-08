/**
 * Model Listing Service
 * Fetches available models from AI provider APIs (OpenAI, Anthropic, OpenRouter)
 */
import { createScopedLogger } from '../utils/logger'
import { getDecryptedConfig, ConfigKeys } from '../repositories/configRepository'

const log = createScopedLogger('service:model-listing')

// ============================================================================
// TYPES
// ============================================================================

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

export interface ModelListResponse {
  models: ModelInfo[]
  provider: string
  error?: string
}

// Fallback models when API fails or no key is available
const FALLBACK_MODELS: Record<string, ModelInfo[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-4', name: 'GPT-4', provider: 'openai', contextLength: 8192 },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', contextLength: 16385 },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', contextLength: 200000 },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000 },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', contextLength: 200000 },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic', contextLength: 200000 },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic', contextLength: 200000 },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextLength: 64000 },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'deepseek', contextLength: 64000 },
  ],
  openrouter: [], // OpenRouter models are always fetched from API
}

// ============================================================================
// OPENAI MODEL LISTING
// ============================================================================

interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

interface OpenAIModelsResponse {
  object: string
  data: OpenAIModel[]
}

export async function fetchOpenAIModels(apiKey?: string): Promise<ModelListResponse> {
  const key = apiKey || await getDecryptedConfig(ConfigKeys.OPENAI_API_KEY)
  
  if (!key) {
    log.info('No OpenAI API key available, returning fallback models')
    return {
      models: FALLBACK_MODELS.openai,
      provider: 'openai',
    }
  }

  try {
    const baseUrl = process.env.OPENAI_API_URL || 'https://api.openai.com'
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
    }

    const data: OpenAIModelsResponse = await response.json()
    
    // Filter to chat models only and sort by creation date (newest first)
    const chatModels = data.data
      .filter(m => 
        m.id.includes('gpt') || 
        m.id.includes('o1') ||
        m.id.includes('chatgpt')
      )
      .filter(m => !m.id.includes('instruct') && !m.id.includes('realtime') && !m.id.includes('audio'))
      .sort((a, b) => b.created - a.created)
      .map(m => ({
        id: m.id,
        name: formatModelName(m.id),
        provider: 'openai',
        description: `Owned by ${m.owned_by}`,
      }))

    log.info('Fetched OpenAI models', { count: chatModels.length })

    return {
      models: chatModels.length > 0 ? chatModels : FALLBACK_MODELS.openai,
      provider: 'openai',
    }
  } catch (error) {
    log.error('Failed to fetch OpenAI models', { error })
    return {
      models: FALLBACK_MODELS.openai,
      provider: 'openai',
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    }
  }
}

// ============================================================================
// ANTHROPIC MODEL LISTING
// ============================================================================

interface AnthropicModel {
  id: string
  display_name: string
  created_at: string
  type: string
}

interface AnthropicModelsResponse {
  data: AnthropicModel[]
  first_id: string
  last_id: string
  has_more: boolean
}

export async function fetchAnthropicModels(apiKey?: string): Promise<ModelListResponse> {
  const key = apiKey || await getDecryptedConfig(ConfigKeys.ANTHROPIC_API_KEY)
  
  if (!key) {
    log.info('No Anthropic API key available, returning fallback models')
    return {
      models: FALLBACK_MODELS.anthropic,
      provider: 'anthropic',
    }
  }

  try {
    const baseUrl = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`)
    }

    const data: AnthropicModelsResponse = await response.json()
    
    const models = data.data.map(m => ({
      id: m.id,
      name: m.display_name || formatModelName(m.id),
      provider: 'anthropic',
    }))

    log.info('Fetched Anthropic models', { count: models.length })

    return {
      models: models.length > 0 ? models : FALLBACK_MODELS.anthropic,
      provider: 'anthropic',
    }
  } catch (error) {
    log.error('Failed to fetch Anthropic models', { error })
    return {
      models: FALLBACK_MODELS.anthropic,
      provider: 'anthropic',
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    }
  }
}

// ============================================================================
// OPENROUTER MODEL LISTING
// ============================================================================

interface OpenRouterModel {
  id: string
  name: string
  created?: number
  pricing?: {
    prompt: string
    completion: string
    request?: string
    image?: string
  }
  context_length?: number
  architecture?: {
    modality: string
    input_modalities: string[]
    output_modalities: string[]
    tokenizer: string
    instruct_type?: string
  }
  top_provider?: {
    is_moderated: boolean
    context_length: number
    max_completion_tokens: number
  }
  description?: string
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[]
}

export async function fetchOpenRouterModels(apiKey?: string): Promise<ModelListResponse> {
  const key = apiKey || await getDecryptedConfig(ConfigKeys.OPENROUTER_API_KEY)
  
  // OpenRouter models endpoint doesn't require auth, but user endpoint does
  const endpoint = key 
    ? 'https://openrouter.ai/api/v1/models/user'
    : 'https://openrouter.ai/api/v1/models'

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
    }

    const data: OpenRouterModelsResponse = await response.json()
    
    // Filter to text-to-text models and sort by popularity/recency
    const models = data.data
      .filter(m => {
        const modality = m.architecture?.modality || ''
        return modality.includes('text') || modality === ''
      })
      .map(m => ({
        id: m.id,
        name: m.name,
        provider: 'openrouter',
        contextLength: m.context_length || m.top_provider?.context_length,
        description: m.description,
        pricing: m.pricing ? {
          prompt: m.pricing.prompt,
          completion: m.pricing.completion,
        } : undefined,
      }))

    log.info('Fetched OpenRouter models', { count: models.length })

    return {
      models,
      provider: 'openrouter',
    }
  } catch (error) {
    log.error('Failed to fetch OpenRouter models', { error })
    return {
      models: [],
      provider: 'openrouter',
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    }
  }
}

// ============================================================================
// DEEPSEEK MODEL LISTING (no API, use fallback)
// ============================================================================

export async function fetchDeepSeekModels(): Promise<ModelListResponse> {
  // DeepSeek doesn't have a public models endpoint
  return {
    models: FALLBACK_MODELS.deepseek,
    provider: 'deepseek',
  }
}

// ============================================================================
// COMBINED MODEL FETCHING
// ============================================================================

export type Provider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter'

export async function fetchModelsForProvider(
  provider: Provider,
  apiKey?: string
): Promise<ModelListResponse> {
  switch (provider) {
    case 'openai':
      return fetchOpenAIModels(apiKey)
    case 'anthropic':
      return fetchAnthropicModels(apiKey)
    case 'deepseek':
      return fetchDeepSeekModels()
    case 'openrouter':
      return fetchOpenRouterModels(apiKey)
    default:
      return {
        models: [],
        provider: provider as string,
        error: `Unknown provider: ${provider}`,
      }
  }
}

export async function fetchAllModels(): Promise<Record<Provider, ModelListResponse>> {
  const [openai, anthropic, deepseek, openrouter] = await Promise.all([
    fetchOpenAIModels(),
    fetchAnthropicModels(),
    fetchDeepSeekModels(),
    fetchOpenRouterModels(),
  ])

  return {
    openai,
    anthropic,
    deepseek,
    openrouter,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatModelName(id: string): string {
  // Convert model IDs to human-readable names
  return id
    .replace(/-/g, ' ')
    .replace(/gpt/gi, 'GPT')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
}
