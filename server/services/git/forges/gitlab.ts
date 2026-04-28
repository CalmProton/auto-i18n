import { getSetting } from '../../../utils/getSetting'
import type { GitForge, ForgeFile, CreatePROptions, CreateIssueOptions, PRResult, IssueResult } from '../types'

export class GitLabForge implements GitForge {
  private async getHeaders(): Promise<Record<string, string>> {
    const token = await getSetting('GITLAB_TOKEN')
    if (!token) throw new Error('GITLAB_TOKEN not configured')
    return {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    }
  }

  private async getBaseUrl(): Promise<string> {
    const url = await getSetting('GITLAB_API_URL')
    return ((url ?? 'https://gitlab.com').replace(/\/$/, '')) + '/api/v4'
  }

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`)
  }

  private async glFetch(path: string, init: RequestInit): Promise<any> {
    const base = await this.getBaseUrl()
    const headers = await this.getHeaders()
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitLab API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  async createBranch(repoOwner: string, repoName: string, branchName: string, fromSha: string): Promise<void> {
    const project = this.projectPath(repoOwner, repoName)
    try {
      await this.glFetch(`/projects/${project}/repository/branches/${encodeURIComponent(branchName)}`, { method: 'GET' })
      return // already exists
    } catch {}

    await this.glFetch(`/projects/${project}/repository/branches`, {
      method: 'POST',
      body: JSON.stringify({ branch: branchName, ref: fromSha }),
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
    const project = this.projectPath(repoOwner, repoName)

    const actions = files.map(f => ({
      action: 'create' as const,
      file_path: f.path,
      content: f.content,
      encoding: 'text' as const,
    }))

    const commit = await this.glFetch(`/projects/${project}/repository/commits`, {
      method: 'POST',
      body: JSON.stringify({ branch, commit_message: message, actions }),
    })

    return commit.id
  }

  async createPR(opts: CreatePROptions): Promise<PRResult> {
    const project = this.projectPath(opts.repoOwner, opts.repoName)
    const mr = await this.glFetch(`/projects/${project}/merge_requests`, {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        description: opts.body,
        source_branch: opts.head,
        target_branch: opts.base,
      }),
    })
    return { number: mr.iid, url: mr.web_url }
  }

  async createIssue(opts: CreateIssueOptions): Promise<IssueResult> {
    const project = this.projectPath(opts.repoOwner, opts.repoName)
    const issue = await this.glFetch(`/projects/${project}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: opts.title, description: opts.body }),
    })
    return { number: issue.iid }
  }
}
