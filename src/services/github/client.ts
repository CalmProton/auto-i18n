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
      log.error('GitHub API request failed', {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        body: text
      })
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
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

  async updateRef(owner: string, repo: string, ref: string, sha: string): Promise<GitRef> {
    return this.request<GitRef>({
      method: 'PATCH',
      path: `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(ref)}`,
      body: {
        sha,
        force: false
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
}
