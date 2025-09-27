import { createScopedLogger } from '../utils/logger'

export interface GitHubConfig {
  token: string
  apiBaseUrl: string
  userAgent: string
}

const log = createScopedLogger('config:github')
let cachedConfig: GitHubConfig | null = null

function readEnv(name: string): string | undefined {
  if (typeof Bun !== 'undefined') {
    return Bun.env[name]
  }
  if (typeof process !== 'undefined') {
    return process.env?.[name]
  }
  return undefined
}

function loadGitHubConfig(): GitHubConfig {
  const token = readEnv('AUTO_I18N_GITHUB_TOKEN') || readEnv('GITHUB_TOKEN')
  if (!token) {
    throw new Error('Missing GitHub token. Set AUTO_I18N_GITHUB_TOKEN or GITHUB_TOKEN environment variable.')
  }

  const apiBaseUrl = readEnv('AUTO_I18N_GITHUB_API_URL') || 'https://api.github.com'
  const userAgent = readEnv('AUTO_I18N_GITHUB_APP_NAME') || 'auto-i18n-bot'

  log.info('Loaded GitHub configuration', {
    apiBaseUrl,
    userAgent
  })

  return {
    token,
    apiBaseUrl,
    userAgent
  }
}

export function getGitHubConfig(): GitHubConfig {
  if (!cachedConfig) {
    cachedConfig = loadGitHubConfig()
  }
  return cachedConfig
}

export function resetGitHubConfigCache(): void {
  cachedConfig = null
}
