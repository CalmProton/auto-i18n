import { getSetting } from '../../../utils/getSetting'
import type { GitForge, ForgeFile, CreatePROptions, CreateIssueOptions, PRResult, IssueResult } from '../types'

export class GitHubForge implements GitForge {
  private async getHeaders(): Promise<Record<string, string>> {
    const token = await getSetting('GITHUB_TOKEN')
    if (!token) throw new Error('GITHUB_TOKEN not configured')
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'auto-i18n/2.0',
    }
  }

  private async getBaseUrl(): Promise<string> {
    const url = await getSetting('GITHUB_API_URL')
    return (url ?? 'https://api.github.com').replace(/\/$/, '')
  }

  private async ghFetch(path: string, init: RequestInit): Promise<any> {
    const base = await this.getBaseUrl()
    const headers = await this.getHeaders()
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  async createBranch(repoOwner: string, repoName: string, branchName: string, fromSha: string): Promise<void> {
    // Check if branch already exists
    try {
      await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/refs/heads/${branchName}`, { method: 'GET' })
      // Branch exists — nothing to do
      return
    } catch {
      // 404 means it doesn't exist — create it
    }

    await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
    })
  }

  async pushFiles(
    repoOwner: string,
    repoName: string,
    branch: string,
    files: ForgeFile[],
    message: string,
  ): Promise<string> {
    if (files.length === 0) return ''

    // Get the current branch SHA to use as parent
    const refData = await this.ghFetch(
      `/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`,
      { method: 'GET' },
    )
    const parentSha: string = refData.object.sha

    // Get the current tree SHA
    const commitData = await this.ghFetch(
      `/repos/${repoOwner}/${repoName}/git/commits/${parentSha}`,
      { method: 'GET' },
    )
    const baseTreeSha: string = commitData.tree.sha

    // Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (f) => {
        const blob = await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({
            content: f.encoding === 'base64' ? f.content : btoa(unescape(encodeURIComponent(f.content))),
            encoding: 'base64',
          }),
        })
        return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha }
      }),
    )

    // Create tree
    const treeData = await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    })

    // Create commit
    const commitResult = await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: treeData.sha, parents: [parentSha] }),
    })

    // Update branch ref
    await this.ghFetch(`/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitResult.sha }),
    })

    return commitResult.sha
  }

  async createPR(opts: CreatePROptions): Promise<PRResult> {
    const pr = await this.ghFetch(`/repos/${opts.repoOwner}/${opts.repoName}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
      }),
    })
    return { number: pr.number, url: pr.html_url }
  }

  async createIssue(opts: CreateIssueOptions): Promise<IssueResult> {
    const issue = await this.ghFetch(`/repos/${opts.repoOwner}/${opts.repoName}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        labels: ['i18n', 'translation', 'automated'],
      }),
    })
    return { number: issue.number }
  }
}
