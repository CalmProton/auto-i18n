export interface ForgeFile {
  path: string      // target repo path
  content: string   // file content
  encoding?: 'utf-8' | 'base64'
}

export interface CreatePROptions {
  title: string
  body: string
  head: string   // branch name
  base: string   // target branch
  repoOwner: string
  repoName: string
}

export interface CreateIssueOptions {
  title: string
  body: string
  repoOwner: string
  repoName: string
}

export interface PRResult {
  number: number
  url: string
}

export interface IssueResult {
  number: number
}

export interface ForgeWorkflowResult {
  forge: string
  branch?: string
  prNumber?: number
  prUrl?: string
  issueNumber?: number
  webhookUrl?: string
  skipped?: boolean
}

export interface GitForge {
  /** Create a new branch from a given SHA */
  createBranch(repoOwner: string, repoName: string, branchName: string, fromSha: string): Promise<void>
  /** Push (commit) an array of files to a branch in a single commit. Returns the new commit SHA. */
  pushFiles(repoOwner: string, repoName: string, branch: string, files: ForgeFile[], message: string): Promise<string>
  /** Create a PR/MR and return its number and URL */
  createPR(opts: CreatePROptions): Promise<PRResult>
  /** Optionally create an issue. Returns null if not supported. */
  createIssue?(opts: CreateIssueOptions): Promise<IssueResult>
}
