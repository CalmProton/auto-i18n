import { getGitHubConfig } from '../../config/github'
import { createScopedLogger } from '../../utils/logger'

const log = createScopedLogger('services:github:client')

export type GitTreeMode = '100644' | '100755' | '040000' | '160000' | '120000'

export interface GitTreeEntryInput {
  path: string
  mode?: GitTreeMode
  type?: 'blob' | 'tree' | 'commit'
  content?: string
  sha?: string
}

export interface GitRef {
  ref: string
  node_id: string
  url: string
  object: {
    type: 'commit' | 'tree' | 'blob'
    sha: string
    url: string
  }
}

export interface GitCommit {
  sha: string
  node_id: string
  url: string
  message: string
  tree: {
    sha: string
    url: string
  }
  parents: Array<{ sha: string; url: string; html_url?: string }>
}

export interface CreateIssueRequest {
  owner: string
  repo: string
  title: string
  body?: string
  labels?: string[]
}

export interface CreateIssueResponse {
  number: number
  url: string
  html_url: string
  title: string
}

export interface CreatePullRequestRequest {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}

export interface UpdatePullRequestLabelsRequest {
  owner: string
  repo: string
  pull_number: number
  labels: string[]
}

export interface CreateLabelRequest {
  owner: string
  repo: string
  name: string
  color: string
  description?: string
}

export interface Label {
  name: string
  color: string
  description?: string
}

export interface CreatePullRequestResponse {
  number: number
  url: string
  html_url: string
  head: { ref: string }
  base: { ref: string }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

export class GitHubClient {
  private readonly config = getGitHubConfig()

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, this.config.apiBaseUrl)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) {
          continue
        }
        url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, query, body } = options
    const url = this.buildUrl(path, query)

    const headers: HeadersInit = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': this.config.userAgent,
      'X-GitHub-Api-Version': '2022-11-28'
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const text = await response.text()
      
      // Don't log 404s as errors for expected cases
      const is404NotFound = response.status === 404
      const isExpected404 = is404NotFound && (
        path.includes('/git/ref/') ||  // Branch/reference checks
        path.includes('/branches/')    // Branch existence checks
      )
      
      // Check if this is a label creation 422 error (label already exists)
      const isLabelAlreadyExists = response.status === 422 && 
        path.includes('/labels') && 
        method === 'POST' &&
        text.includes('already_exists')
      
      if (isExpected404) {
        log.debug('Resource not found (expected)', {
          method,
          url,
          status: response.status,
          statusText: response.statusText
        })
      } else if (isLabelAlreadyExists) {
        log.debug('Label already exists (expected)', {
          method,
          url,
          status: response.status,
          statusText: response.statusText
        })
      } else {
        log.error('GitHub API request failed', {
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          body: text
        })
      }
      
      const error = new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
      ;(error as any).status = response.status
      ;(error as any).body = text
      throw error
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return (await response.json()) as T
    }

    return (await response.text()) as T
  }

  async getRef(owner: string, repo: string, ref: string): Promise<GitRef> {
    return this.request<GitRef>({
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(ref)}`
    })
  }

  async refExists(owner: string, repo: string, ref: string): Promise<boolean> {
    try {
      await this.getRef(owner, repo, ref)
      return true
    } catch (error: any) {
      if (error.message.includes('404')) {
        return false
      }
      throw error
    }
  }

  async createRef(owner: string, repo: string, ref: string, sha: string): Promise<GitRef> {
    return this.request<GitRef>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/refs`,
      body: {
        ref: `refs/${ref.replace(/^refs\//, '')}`,
        sha
      }
    })
  }

  async updateRef(owner: string, repo: string, ref: string, sha: string, force = false): Promise<GitRef> {
    return this.request<GitRef>({
      method: 'PATCH',
      path: `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(ref)}`,
      body: {
        sha,
        force
      }
    })
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<GitCommit> {
    return this.request<GitCommit>({
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/commits/${sha}`
    })
  }

  async createTree(
    owner: string,
    repo: string,
    entries: GitTreeEntryInput[],
    baseTree?: string
  ): Promise<{ sha: string }> {
    return this.request<{ sha: string }>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/trees`,
      body: {
        base_tree: baseTree,
        tree: entries
      }
    })
  }

  async createBlob(owner: string, repo: string, content: string): Promise<{ sha: string }> {
    return this.request<{ sha: string }>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/blobs`,
      body: {
        content,
        encoding: 'utf-8'
      }
    })
  }

  async createCommit(
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parents: string[]
  ): Promise<GitCommit> {
    return this.request<GitCommit>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/commits`,
      body: {
        message,
        tree: treeSha,
        parents
      }
    })
  }

  async createIssue(request: CreateIssueRequest): Promise<CreateIssueResponse> {
    const { owner, repo, ...body } = request
    return this.request<CreateIssueResponse>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/issues`,
      body
    })
  }

  async createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResponse> {
    const { owner, repo, ...body } = request
    return this.request<CreatePullRequestResponse>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/pulls`,
      body
    })
  }

  async updatePullRequestLabels(request: UpdatePullRequestLabelsRequest): Promise<void> {
    const { owner, repo, pull_number, labels } = request
    await this.request<{ labels: Array<{ name: string }> }>({
      method: 'PATCH',
      path: `/repos/${owner}/${repo}/issues/${pull_number}`,
      body: { labels }
    })
  }

  async getLabels(owner: string, repo: string): Promise<Label[]> {
    return this.request<Label[]>({
      method: 'GET',
      path: `/repos/${owner}/${repo}/labels`
    })
  }

  async createLabel(request: CreateLabelRequest): Promise<Label> {
    const { owner, repo, ...body } = request
    return this.request<Label>({
      method: 'POST',
      path: `/repos/${owner}/${repo}/labels`,
      body
    })
  }

  async ensureLabelsExist(owner: string, repo: string, requiredLabels: Label[]): Promise<void> {
    try {
      const existingLabels = await this.getLabels(owner, repo)
      const existingLabelNames = new Set(existingLabels.map(label => label.name))

      for (const labelDef of requiredLabels) {
        if (!existingLabelNames.has(labelDef.name)) {
          try {
            await this.createLabel({
              owner,
              repo,
              name: labelDef.name,
              color: labelDef.color,
              description: labelDef.description
            })
            log.info('Created label', { owner, repo, label: labelDef.name })
          } catch (error: any) {
            // Check if it's an "already exists" error (422 with specific body content)
            const isAlreadyExists = error?.status === 422 && 
              (error?.body?.includes('already_exists') || error?.message?.includes('already_exists'))
            
            if (isAlreadyExists) {
              log.debug('Label already exists (skipping)', { owner, repo, label: labelDef.name })
            } else {
              log.warn('Failed to create label', { owner, repo, label: labelDef.name, error })
            }
          }
        }
      }
    } catch (error) {
      log.warn('Failed to ensure labels exist', { owner, repo, error })
    }
  }

  /**
   * Get file content from a specific commit
   */
  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
    interface FileContentResponse {
      type: string
      encoding: string
      content: string
      sha: string
    }

    const response = await this.request<FileContentResponse>({
      method: 'GET',
      path: `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      query: { ref }
    })

    if (response.encoding === 'base64') {
      return Buffer.from(response.content, 'base64').toString('utf-8')
    }

    return response.content
  }
}
