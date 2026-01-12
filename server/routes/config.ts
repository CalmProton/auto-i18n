/**
 * Config Routes
 * API endpoints for managing system configuration
 */
import { Elysia, t } from 'elysia'
import {
  getConfig,
  getAllConfig,
  setConfig,
  deleteConfig,
  ConfigKeys,
  type ConfigValue,
} from '../repositories/configRepository'
import {
  fetchModelsForProvider,
  fetchAllModels,
  type Provider,
  type ModelInfo,
} from '../services/modelListingService'
import { resetTranslationConfigCache } from '../config/env'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('routes:config')

// Type helper for route context
type RouteContext = {
  params: Record<string, string>
  query: Record<string, string | undefined>
  body: unknown
  set: { status?: number }
}

const configRoutes = new Elysia({ prefix: '/api/config' })

// ============================================================================
// GET ALL CONFIG
// ============================================================================

configRoutes.get('/', async () => {
  try {
    const configs = await getAllConfig()
    
    // Group configs by category
    const grouped = {
      general: configs.filter(c => ['mock_translations'].includes(c.key)),
      provider: configs.filter(c => ['translation_provider', 'default_model'].includes(c.key)),
      openai: configs.filter(c => c.key.startsWith('openai_')),
      anthropic: configs.filter(c => c.key.startsWith('anthropic_')),
      deepseek: configs.filter(c => c.key.startsWith('deepseek_')),
      openrouter: configs.filter(c => c.key.startsWith('openrouter_')),
    }

    return {
      success: true,
      configs,
      grouped,
    }
  } catch (error) {
    log.error('Failed to get all config', { error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get configuration',
    }
  }
})

// ============================================================================
// GET SINGLE CONFIG
// ============================================================================

configRoutes.get(
  '/:key',
  async (ctx: RouteContext) => {
    const params = ctx.params as { key: string }
    try {
      const config = await getConfig(params.key)
      
      if (!config) {
        return {
          success: false,
          error: `Configuration key '${params.key}' not found`,
        }
      }

      return {
        success: true,
        config,
      }
    } catch (error) {
      log.error('Failed to get config', { key: params.key, error })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get configuration',
      }
    }
  },
  {
    params: t.Object({
      key: t.String(),
    }),
  }
)

// ============================================================================
// SET CONFIG
// ============================================================================

configRoutes.put(
  '/:key',
  async (ctx: RouteContext) => {
    const params = ctx.params as { key: string }
    const body = ctx.body as { value: unknown; description?: string; isSensitive?: boolean }
    try {
      const { value, description, isSensitive } = body

      // Determine if the key is sensitive by default
      const sensitiveKeys = [
        ConfigKeys.OPENAI_API_KEY,
        ConfigKeys.ANTHROPIC_API_KEY,
        ConfigKeys.DEEPSEEK_API_KEY,
        ConfigKeys.OPENROUTER_API_KEY,
      ]
      const isKeysSensitive = isSensitive ?? sensitiveKeys.includes(params.key as any)

      const config = await setConfig({
        key: params.key,
        value,
        description,
        isSensitive: isKeysSensitive,
      })

      // Reset the translation config cache when relevant settings change
      const translationConfigKeys = [
        ConfigKeys.MOCK_TRANSLATIONS,
        ConfigKeys.TRANSLATION_PROVIDER,
        ConfigKeys.DEFAULT_MODEL,
        ConfigKeys.OPENAI_API_KEY,
        ConfigKeys.OPENAI_MODEL,
        ConfigKeys.ANTHROPIC_API_KEY,
        ConfigKeys.ANTHROPIC_MODEL,
        ConfigKeys.DEEPSEEK_API_KEY,
        ConfigKeys.DEEPSEEK_MODEL,
        ConfigKeys.OPENROUTER_API_KEY,
        ConfigKeys.OPENROUTER_MODEL,
      ]
      
      if (translationConfigKeys.includes(params.key as any)) {
        resetTranslationConfigCache()
        log.info('Reset translation config cache after config update', { key: params.key })
      }

      return {
        success: true,
        config,
      }
    } catch (error) {
      log.error('Failed to set config', { key: params.key, error })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set configuration',
      }
    }
  },
  {
    params: t.Object({
      key: t.String(),
    }),
  }
)

// ============================================================================
// BATCH SET CONFIG
// ============================================================================

configRoutes.post(
  '/batch',
  async (ctx: RouteContext) => {
    const body = ctx.body as { configs: Array<{ key: string; value: unknown; description?: string; isSensitive?: boolean }> }
    try {
      const { configs } = body

      const results: ConfigValue[] = []
      const errors: Array<{ key: string; error: string }> = []

      const sensitiveKeys = [
        ConfigKeys.OPENAI_API_KEY,
        ConfigKeys.ANTHROPIC_API_KEY,
        ConfigKeys.DEEPSEEK_API_KEY,
        ConfigKeys.OPENROUTER_API_KEY,
      ]

      for (const config of configs) {
        try {
          const isKeysSensitive = config.isSensitive ?? sensitiveKeys.includes(config.key as any)
          
          const result = await setConfig({
            key: config.key,
            value: config.value,
            description: config.description,
            isSensitive: isKeysSensitive,
          })
          results.push(result)
        } catch (err) {
          errors.push({
            key: config.key,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      // Reset translation config cache
      resetTranslationConfigCache()
      log.info('Reset translation config cache after batch config update')

      return {
        success: errors.length === 0,
        configs: results,
        errors: errors.length > 0 ? errors : undefined,
      }
    } catch (error) {
      log.error('Failed to batch set config', { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set configuration',
      }
    }
  }
)

// ============================================================================
// DELETE CONFIG
// ============================================================================

configRoutes.delete(
  '/:key',
  async (ctx: RouteContext) => {
    const params = ctx.params as { key: string }
    try {
      const deleted = await deleteConfig(params.key)
      
      if (!deleted) {
        return {
          success: false,
          error: `Configuration key '${params.key}' not found`,
        }
      }

      // Reset translation config cache
      resetTranslationConfigCache()

      return {
        success: true,
        message: `Configuration '${params.key}' deleted`,
      }
    } catch (error) {
      log.error('Failed to delete config', { key: params.key, error })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete configuration',
      }
    }
  },
  {
    params: t.Object({
      key: t.String(),
    }),
  }
)

// ============================================================================
// GET AVAILABLE MODELS
// ============================================================================

configRoutes.get(
  '/models/:provider',
  async (ctx: RouteContext) => {
    const params = ctx.params as { provider: string }
    const query = ctx.query as { apiKey?: string } | undefined
    try {
      const provider = params.provider as Provider
      const validProviders = ['openai', 'anthropic', 'deepseek', 'openrouter']
      
      if (!validProviders.includes(provider)) {
        return {
          success: false,
          error: `Invalid provider: ${provider}. Valid providers: ${validProviders.join(', ')}`,
        }
      }

      // Optional API key from query (for testing without saving)
      const apiKey = query?.apiKey as string | undefined

      const result = await fetchModelsForProvider(provider, apiKey)

      return {
        success: true,
        ...result,
      }
    } catch (error) {
      log.error('Failed to fetch models', { provider: params.provider, error })
      return {
        success: false,
        provider: params.provider,
        models: [],
        error: error instanceof Error ? error.message : 'Failed to fetch models',
      }
    }
  },
  {
    params: t.Object({
      provider: t.String(),
    }),
    query: t.Optional(t.Object({
      apiKey: t.Optional(t.String()),
    })),
  }
)

// ============================================================================
// GET ALL AVAILABLE MODELS
// ============================================================================

configRoutes.get('/models', async () => {
  try {
    const allModels = await fetchAllModels()

    return {
      success: true,
      providers: allModels,
    }
  } catch (error) {
    log.error('Failed to fetch all models', { error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    }
  }
})

// ============================================================================
// GET CURRENT PROVIDER STATUS
// ============================================================================

configRoutes.get('/status', async () => {
  try {
    const [
      mockMode,
      provider,
      defaultModel,
    ] = await Promise.all([
      getConfig<boolean>(ConfigKeys.MOCK_TRANSLATIONS),
      getConfig<string>(ConfigKeys.TRANSLATION_PROVIDER),
      getConfig<string>(ConfigKeys.DEFAULT_MODEL),
    ])

    // Check which providers have API keys configured
    const [openaiKey, anthropicKey, deepseekKey, openrouterKey] = await Promise.all([
      getConfig(ConfigKeys.OPENAI_API_KEY),
      getConfig(ConfigKeys.ANTHROPIC_API_KEY),
      getConfig(ConfigKeys.DEEPSEEK_API_KEY),
      getConfig(ConfigKeys.OPENROUTER_API_KEY),
    ])

    return {
      success: true,
      status: {
        mockModeEnabled: mockMode?.value ?? false,
        currentProvider: provider?.value ?? null,
        defaultModel: defaultModel?.value ?? null,
        configuredProviders: {
          openai: openaiKey !== null,
          anthropic: anthropicKey !== null,
          deepseek: deepseekKey !== null,
          openrouter: openrouterKey !== null,
        },
      },
    }
  } catch (error) {
    log.error('Failed to get config status', { error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get status',
    }
  }
})

export default configRoutes
