# Auto-i18n v2 — Rebuild Plan

## Overview

v2 collapses the current split architecture (Vue SPA + ElysiaJS backend + PostgreSQL container) into a single Nuxt 4 project where every concern lives together. The structure is directly modelled on yt-automation's `content-pipe` app. The rebuild also takes the opportunity to fix several architectural problems in v1.

---

## What Changes vs v1

| Concern | v1 | v2 |
|---|---|---|
| Frontend | Vue 3 + Vite (separate dev server, port 5173) | Nuxt 4 SPA (`ssr: false`) |
| Backend | ElysiaJS (separate server, port 3000) | Nitro (built into Nuxt, same port) |
| API routing | ElysiaJS route groups | Nitro file-based `server/api/` routes |
| Database | PostgreSQL (requires Docker or external instance) | SQLite via `better-sqlite3` (zero infra) |
| ORM | Drizzle (PostgreSQL dialect) | Drizzle (SQLite dialect) |
| DB bootstrap | Manual `bun run db:migrate` | Auto-migrates on server start (Nitro plugin) |
| Job queue | PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` | In-process queue backed by SQLite jobs table |
| File storage | Hybrid: DB + `tmp/` directory tree | DB only — no filesystem for translation content |
| Config | `.env` only | DB `settings` table with `.env` fallback — editable at runtime via Settings tab |
| Real-time providers | OpenAI, Anthropic, DeepSeek, OpenRouter (4 implementations) | OpenRouter only (1 implementation) |
| Batch providers | OpenAI Batch API only | OpenAI Batch API + Anthropic Message Batches API |
| Git integration | GitHub-only (Octokit hardcoded) | Abstracted `GitForge` interface: GitHub, GitLab, Webhook, None |
| Upload API | 3 separate endpoints (content, global, page) | 1 unified endpoint with per-file type metadata |
| Locale validation | 32-locale hardcoded allowlist | Accept any valid locale code (format-validated + normalized) |
| Translation prompts | Hardcoded in provider files | Stored in `settings` table, fully overridable |
| GitHub Issues | Always created on PR workflow | Optional (off by default) |
| GitHub Labels | Auto-created on every workflow run | Removed |
| Deployment | Two processes + Docker PostgreSQL | Single `nuxt build` + `node .output/server/index.mjs` |
| Docker | Multi-container (app + postgres) | Optional single container (no DB container needed) |

### What stays the same

- Both session types: `upload` (full file set) and `changes` (delta)
- Three file content types: `content` (markdown), `global` (JSON), `page` (JSON)
- Translation prompts (content/format/quality — just now stored in settings and overridable)
- GitHub PR workflow with seed commit + translation commit structure
- Optional `ACCESS_KEY` authentication
- SSE for real-time pipeline events
- Dashboard UI: Sessions, Batches, Translations, GitHub, Settings tabs
- Pipeline event audit log
- AI request logging
- StaggeredRequestQueue throttle for LLM calls

---

## Tech Stack

```
Framework:     Nuxt 4 (ssr: false)
Server:        Nitro (built-in)
Database:      SQLite via better-sqlite3
ORM:           Drizzle ORM (sqlite dialect)
Styling:       Tailwind CSS v4 (Vite plugin, no config file)
UI components: shadcn-vue (reka-ui) + lucide-vue-next
AI providers:  openai SDK (for OpenAI Batch + OpenRouter calls), @anthropic-ai/sdk (for Anthropic Batch)
Validation:    Zod v4
Runtime:       Bun
```

---

## Provider Architecture

### The problem with v1

v1 has 6 provider classes (OpenAI, Anthropic, DeepSeek, OpenRouter, Mock, NoOp) that all do the same thing with slightly different HTTP wrappers. The user configures one provider globally and everything routes through it. DeepSeek is available through OpenRouter. Anthropic has a latent bug where JSON translation responses are handled inconsistently from every other provider (doesn't unwrap the `translation` key).

### v2 provider model

Two distinct modes: real-time and batch. Each has its own implementation.

**Real-time translation → OpenRouter**
One API key, access to every model (OpenAI, Anthropic, DeepSeek, Llama, Mistral, any future model). The user sets an `OPENROUTER_API_KEY` and a model string (e.g. `anthropic/claude-3-haiku`, `openai/gpt-4o-mini`, `google/gemini-flash-1.5`). No provider selection — model string implies the provider. DeepSeek is `deepseek/deepseek-chat` through OpenRouter.

**Batch translation → OpenAI Batch API or Anthropic Message Batches API**
Both offer ~50% cost reduction for async workloads. User can configure one or both. When batch mode is triggered, it uses whichever batch provider has credentials configured. If neither has credentials, batch mode falls back to real-time via OpenRouter.

**Mock → stays for development/testing**

### Provider class reduction

| v1 | v2 |
|---|---|
| `OpenAIProvider` | `OpenRouterProvider` (real-time) |
| `AnthropicProvider` | `OpenAIBatchProvider` (batch only) |
| `DeepSeekProvider` | `AnthropicBatchProvider` (batch only) |
| `OpenRouterProvider` | `MockProvider` |
| `MockProvider` | — |
| `NoOpTranslationProvider` | — |

NoOp is replaced by a simple check: if no OpenRouter key is configured, the pipeline records a warning event and skips translation entirely rather than silently returning original content.

### Settings for providers

```
OPENROUTER_API_KEY      required for real-time translation
OPENROUTER_MODEL        model string, e.g. 'openai/gpt-4o-mini'
OPENAI_API_KEY          optional, enables OpenAI Batch mode
OPENAI_BATCH_MODEL      model for batch jobs, e.g. 'gpt-4o-mini'
ANTHROPIC_API_KEY       optional, enables Anthropic Batch mode
ANTHROPIC_BATCH_MODEL   model for batch jobs, e.g. 'claude-3-haiku-20240307'
BATCH_PROVIDER          'openai' | 'anthropic' | 'auto' (auto picks whichever is configured)
MOCK_MODE               'true' | 'false'
```

---

## Git Forge Abstraction

### The problem with v1

The GitHub workflow (`services/github/workflow.ts`) makes direct Octokit calls throughout. Every operation (branch creation, commits, label creation, issue creation, PR creation) is GitHub-specific. Users on GitLab, Gitea, Bitbucket, or any self-hosted git platform cannot use the automatic PR creation feature at all.

### v2 forge model

A `GitForge` interface defines what operations a forge must support:

```ts
interface GitForge {
  // Required
  createBranch(name: string, fromSha: string): Promise<void>
  pushFiles(branch: string, files: ForgeFile[], message: string): Promise<string>
  createPR(opts: CreatePROptions): Promise<{ number: number; url: string }>

  // Optional
  createIssue?(opts: CreateIssueOptions): Promise<{ number: number }>
}
```

Four forge modes, set via `GIT_FORGE` in settings:

| Mode | What it does |
|---|---|
| `github` | Current GitHub behavior: branch → commits → PR. Optionally creates an issue (controlled by `GIT_CREATE_ISSUES=true`, off by default). |
| `gitlab` | GitLab equivalent: branch → commits → Merge Request. GitLab doesn't support pre-PR issues the same way, so issue creation is skipped. |
| `webhook` | No git operations. When translation completes, POSTs the full translated file set as JSON to `WEBHOOK_URL`. CI receives the payload and handles the branch/commit/PR itself. Covers any platform (Gitea, Bitbucket, Azure DevOps, etc.). |
| `none` | No git operations. Translations are stored in DB. CI polls `GET /api/sessions/:id/output` to retrieve files and handles git itself. Dashboard shows session as "complete, awaiting git" until CI reports back. |

For `webhook` and `none` modes, no git credentials are needed at all in auto-i18n.

### Webhook payload shape

```json
{
  "event": "translation.completed",
  "sessionId": "...",
  "senderId": "...",
  "sourceLocale": "en",
  "targetLocales": ["fr", "de", "ja"],
  "files": [
    {
      "type": "content",
      "locale": "fr",
      "path": "content/fr/blog/intro.md",
      "content": "..."
    }
  ]
}
```

CI receives this and can create a branch, commit all files, and open a PR in whatever platform it uses.

### Settings for git forge

```
GIT_FORGE              'github' | 'gitlab' | 'webhook' | 'none'
GITHUB_TOKEN           for github mode
GITHUB_API_URL         optional, for GitHub Enterprise
GITLAB_TOKEN           for gitlab mode
GITLAB_API_URL         GitLab instance URL, e.g. 'https://gitlab.example.com'
WEBHOOK_URL            for webhook mode
WEBHOOK_SECRET         optional, added as X-Webhook-Secret header
GIT_CREATE_ISSUES      'true' | 'false', default 'false' (github mode only)
ACCESS_KEY             optional, enables dashboard auth
```

---

## Upload API Unification

### The problem with v1

Three separate CI-facing upload endpoints:
- `POST /translate/content` — markdown files
- `POST /translate/global` — single JSON file
- `POST /translate/page` — multiple folder JSON files

CI workflows must call all three in sequence. Each has its own request shape, its own parser, slightly different error behavior.

### v2 unified upload

**`POST /api/translate/upload`** accepts an array of files in one multipart request. Each file includes a `type` field that tells the server which processor to use:

```
FormData fields:
  senderId        string
  sourceLocale    string
  targetLocales   string (JSON array)
  repoOwner       string
  repoName        string
  repoBranch      string
  baseCommitSha   string
  sessionType     'upload' | 'changes'
  files[]         file blob
  fileTypes[]     'content' | 'global' | 'page'  (parallel array to files[])
  filePaths[]     string  (relative paths, parallel array)
```

Internally the server still routes each file to the correct processor (`translateMarkdown` for content, `translateJson` for global/page). The distinction between content types is preserved — it just no longer maps 1:1 to endpoints.

The session type (`upload` vs `changes`) is kept distinct as a field, not a separate endpoint.

---

## Locale Handling

### The problem with v1

32 locales are hardcoded in `config/locales.ts`. Any locale not in the list is rejected. Users with regional variants (`pt-BR`, `zh-TW`, `es-MX`) or less common locales (`hy`, `ka`, `uz`) cannot use the tool without a code change.

### v2 approach

Accept any locale code from CI. Validate only the format:
- Short form: `^[a-z]{2,3}$` (e.g. `fr`, `ja`, `zho`)
- Long form: `^[a-z]{2,3}-[A-Z]{2,4}$` (e.g. `pt-BR`, `zh-TW`, `zh-Hant`)

Normalize on input: lowercase language tag, uppercase region tag.

For locale display names in prompts, use `Intl.DisplayNames` (built-in to V8/Bun):
```ts
const display = new Intl.DisplayNames(['en'], { type: 'language' })
display.of('pt-BR')  // → "Brazilian Portuguese"
```

Falls back to the locale code itself if `Intl.DisplayNames` doesn't know it.

---

## Customizable Translation Prompts

### The problem with v1

The system prompt and markdown/JSON user prompts are hardcoded in provider files. The markdown prompt contains very specific MDC component handling instructions (`::`  delimiters, YAML blocks) and a hardcoded list of frontmatter fields to preserve/translate. This is only appropriate for Nuxt Content projects. Users translating plain markdown, React MDX, or any other format get the wrong instructions.

### v2 approach

Four prompts stored in `settings` table with the v1 text as defaults:

```
SYSTEM_PROMPT            top-level AI persona instruction
MARKDOWN_USER_PROMPT     user message for markdown translation jobs
JSON_USER_PROMPT         user message for JSON translation jobs
```

All three are editable via the Settings tab in the dashboard. Resettable to defaults with a button.

The prompts use `{{SOURCE_LOCALE}}` and `{{TARGET_LOCALE}}` as substitution variables that the server fills in at runtime.

---

## Project Structure

```
auto-i18n-v2/
├── server/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── check.get.ts          # GET  /api/auth/check
│   │   │   └── validate.post.ts      # POST /api/auth/validate
│   │   ├── sessions/
│   │   │   ├── index.get.ts          # GET  /api/sessions
│   │   │   ├── [id].get.ts           # GET  /api/sessions/:id
│   │   │   ├── [id].delete.ts        # DELETE /api/sessions/:id
│   │   │   └── [id]/
│   │   │       └── output.get.ts     # GET  /api/sessions/:id/output  (download translations)
│   │   ├── translate/
│   │   │   ├── upload.post.ts        # POST /api/translate/upload     (CI: unified file upload)
│   │   │   ├── changes.post.ts       # POST /api/translate/changes    (CI: delta upload)
│   │   │   └── [id]/
│   │   │       ├── process.post.ts   # POST /api/translate/:id/process
│   │   │       ├── finalize.post.ts  # POST /api/translate/:id/finalize
│   │   │       ├── retry.post.ts     # POST /api/translate/:id/retry
│   │   │       ├── reset.post.ts     # POST /api/translate/:id/reset
│   │   │       └── status.get.ts     # GET  /api/translate/:id/status
│   │   ├── batch/
│   │   │   ├── index.post.ts         # POST /api/batch
│   │   │   └── [id]/
│   │   │       ├── submit.post.ts    # POST /api/batch/:id/submit
│   │   │       ├── status.get.ts     # GET  /api/batch/:id/status
│   │   │       ├── process.post.ts   # POST /api/batch/:id/process
│   │   │       └── retry.post.ts     # POST /api/batch/:id/retry
│   │   ├── git/
│   │   │   ├── finalize.post.ts      # POST /api/git/finalize         (trigger PR/MR/webhook)
│   │   │   ├── ready.get.ts          # GET  /api/git/ready
│   │   │   └── [senderId]/
│   │   │       └── status.get.ts     # GET  /api/git/:senderId/status
│   │   ├── pipeline/
│   │   │   └── [senderId]/
│   │   │       ├── events.get.ts     # GET  /api/pipeline/:senderId/events
│   │   │       ├── logs.get.ts       # GET  /api/pipeline/:senderId/logs
│   │   │       ├── cancel.post.ts    # POST /api/pipeline/:senderId/cancel
│   │   │       └── restart.post.ts   # POST /api/pipeline/:senderId/restart
│   │   ├── settings.get.ts           # GET  /api/settings
│   │   ├── settings.put.ts           # PUT  /api/settings
│   │   ├── overview.get.ts           # GET  /api/overview
│   │   └── sse/
│   │       └── [senderId].get.ts     # GET  /api/sse/:senderId
│   ├── db/
│   │   ├── index.ts                  # DB proxy (lazy init, globalThis singleton)
│   │   ├── sqlite.ts                 # better-sqlite3 singleton (WAL, FK, busy timeout)
│   │   ├── schema.ts                 # All Drizzle table definitions
│   │   └── migrations/
│   ├── repositories/
│   │   ├── sessions.ts
│   │   ├── files.ts
│   │   ├── batches.ts
│   │   ├── events.ts
│   │   ├── logs.ts
│   │   └── settings.ts
│   ├── services/
│   │   ├── translation/
│   │   │   ├── providers/
│   │   │   │   ├── openrouter.ts     # Real-time translation via OpenRouter
│   │   │   │   ├── openai-batch.ts   # OpenAI Batch API
│   │   │   │   ├── anthropic-batch.ts# Anthropic Message Batches API
│   │   │   │   └── mock.ts
│   │   │   ├── index.ts              # Provider resolver
│   │   │   ├── prompts.ts            # Load prompts from settings, build with locale substitution
│   │   │   ├── batchService.ts       # Batch job orchestration
│   │   │   └── queue.ts              # StaggeredRequestQueue
│   │   └── git/
│   │       ├── forges/
│   │       │   ├── github.ts         # GitHub forge implementation
│   │       │   ├── gitlab.ts         # GitLab forge implementation
│   │       │   ├── webhook.ts        # Webhook output (POST translated files to URL)
│   │       │   └── none.ts           # No-op (just marks session as ready for retrieval)
│   │       ├── index.ts              # Forge resolver
│   │       └── workflow.ts           # Forge-agnostic: branch → commits → PR/MR/webhook
│   ├── queue/
│   │   └── index.ts                  # In-process job queue (globalThis pattern)
│   ├── utils/
│   │   ├── getSetting.ts             # DB-first + env fallback config reader
│   │   ├── auth.ts                   # Access key validation helper
│   │   ├── sse.ts                    # SSE pub/sub (in-memory, globalThis)
│   │   └── locales.ts                # Locale format validation + Intl.DisplayNames resolver
│   ├── middleware/
│   │   └── auth.ts                   # Nitro middleware (checks X-Access-Key)
│   └── plugins/
│       └── 00.bootstrap.ts           # Start DB, run migrations, recover queue
├── pages/
│   └── index.vue
├── components/
│   ├── tabs/
│   │   ├── SessionsTab.vue
│   │   ├── BatchesTab.vue
│   │   ├── TranslationsTab.vue
│   │   ├── GitTab.vue
│   │   └── SettingsTab.vue
│   ├── SessionDetail.vue
│   ├── PipelineEvents.vue
│   └── ui/
├── composables/
│   ├── useSessions.ts
│   ├── useBatches.ts
│   ├── useTranslations.ts
│   ├── useGit.ts
│   ├── useSettings.ts
│   ├── useSSE.ts
│   ├── useAuth.ts
│   └── usePolling.ts
├── assets/
│   └── css/main.css
├── tmp/
│   └── auto-i18n.sqlite
├── nuxt.config.ts
├── drizzle.config.ts
└── package.json
```

---

## Database Schema

SQLite via Drizzle. All IDs are `text` UUIDs. Timestamps are ISO-8601 `text`.

### `settings`
Runtime configuration. API keys, provider config, git forge config, translation prompts. Replaces `.env` for everything editable at runtime.
```
key        text PK
value      text
updated_at text
```

### `sessions`
One row per CI upload or delta. The root entity.
```
id             text PK (UUID)
sender_id      text UNIQUE
session_type   text    -- 'upload' | 'changes'
status         text    -- 'pending' | 'processing' | 'completed' | 'failed' | 'expired'
source_locale  text
target_locales text    -- JSON array
repo_owner     text
repo_name      text
repo_branch    text
base_commit_sha text
expires_at     text
created_at     text
updated_at     text
```

### `files`
All file content in DB. No tmp/ filesystem.
```
id           text PK
session_id   text FK→sessions(cascade)
file_type    text    -- 'upload' | 'translation' | 'delta' | 'original'
content_type text    -- 'content' | 'global' | 'page'
format       text    -- 'markdown' | 'json'
locale       text
file_path    text    -- original path from CI
content      text
created_at   text
```

### `batches`
One row per batch job (OpenAI or Anthropic).
```
id               text PK
session_id       text FK→sessions(cascade)
provider         text    -- 'openai' | 'anthropic'
status           text    -- 'pending' | 'submitted' | 'processing' | 'completed' | 'failed'
external_batch_id text   -- OpenAI or Anthropic batch ID
manifest         text    -- JSON
total_requests   integer
completed        integer
failed           integer
created_at       text
updated_at       text
```

### `batch_requests`
Individual items within a batch.
```
id            text PK
batch_id      text FK→batches(cascade)
session_id    text FK→sessions(cascade)
custom_id     text
request_body  text    -- JSON
response_body text    -- JSON (nullable until processed)
status        text    -- 'pending' | 'completed' | 'failed'
```

### `git_jobs`
Links sessions to git forge output once created.
```
id          text PK
session_id  text FK→sessions(cascade) UNIQUE
forge       text    -- 'github' | 'gitlab' | 'webhook' | 'none'
issue_number integer  -- nullable, only when GIT_CREATE_ISSUES=true
pr_number   integer  -- nullable
pr_url      text
branch      text
status      text    -- 'pending' | 'completed' | 'failed'
created_at  text
updated_at  text
```

### `jobs`
In-process queue persistence.
```
id           text PK
session_id   text FK→sessions(cascade)
job_type     text    -- 'batch-poll' | 'batch-process' | 'git-finalize' | 'cleanup' | 'stats-update'
status       text    -- 'pending' | 'running' | 'completed' | 'failed'
payload      text    -- JSON
error        text
run_after    text    -- ISO timestamp for delayed jobs
attempts     integer default 0
max_attempts integer default 3
heartbeat_at text
created_at   text
```

### `pipeline_events`
Audit log — one row per pipeline step attempt.
```
id           text PK
session_id   text FK→sessions(cascade)
step         text    -- 'upload' | 'batch-create' | 'batch-submit' | 'batch-poll' | 'translate' | 'git-pr' | 'cleanup'
status       text    -- 'started' | 'completed' | 'failed'
duration_ms  integer
request      text    -- JSON (optional)
response     text    -- JSON (optional)
error        text
created_at   text
```

### `api_request_logs`
Raw AI provider call log.
```
id            text PK
session_id    text FK→sessions(cascade)
provider      text
model         text
request_body  text    -- JSON
response_body text    -- JSON
status_code   integer
duration_ms   integer
is_mock       integer -- boolean
created_at    text
```

---

## Settings Keys Reference

### Translation
| Key | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required for real-time translation |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Any valid OpenRouter model string |
| `OPENAI_API_KEY` | — | Optional; enables OpenAI Batch mode |
| `OPENAI_BATCH_MODEL` | `gpt-4o-mini` | Model used for batch jobs |
| `ANTHROPIC_API_KEY` | — | Optional; enables Anthropic Batch mode |
| `ANTHROPIC_BATCH_MODEL` | `claude-3-haiku-20240307` | Model used for batch jobs |
| `BATCH_PROVIDER` | `auto` | `openai` / `anthropic` / `auto` (picks whichever has a key) |
| `MOCK_MODE` | `false` | |

### Translation Prompts
| Key | Default | Notes |
|---|---|---|
| `SYSTEM_PROMPT` | Expert localization specialist persona (v1 text) | Top-level AI persona instruction |
| `MARKDOWN_USER_PROMPT` | Full MDC-aware markdown prompt (v1 text) | User message for markdown jobs; `{{SOURCE_LOCALE}}` and `{{TARGET_LOCALE}}` substituted at runtime |
| `JSON_USER_PROMPT` | JSON keys-only prompt (v1 text) | User message for JSON jobs; same substitution |

### Git Forge
| Key | Default | Notes |
|---|---|---|
| `GIT_FORGE` | `none` | `github` / `gitlab` / `webhook` / `none` |
| `GITHUB_TOKEN` | — | github mode |
| `GITHUB_API_URL` | `https://api.github.com` | Optional; for GitHub Enterprise |
| `GITLAB_TOKEN` | — | gitlab mode |
| `GITLAB_API_URL` | `https://gitlab.com` | GitLab instance URL |
| `WEBHOOK_URL` | — | webhook mode; receives POST with translated files |
| `WEBHOOK_SECRET` | — | Optional; sent as `X-Webhook-Secret` header |
| `GIT_CREATE_ISSUES` | `false` | github/gitlab only; creates an issue before the PR/MR |

### Auth
| Key | Default | Notes |
|---|---|---|
| `ACCESS_KEY` | — | Optional; if set, enables authentication on all routes |

---

## API Routes Reference

### CI-facing

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/translate/upload` | Upload a full set of source files for translation |
| POST | `/api/translate/changes` | Upload a delta (only changed files) |
| POST | `/api/batch` | Create a batch job from uploaded files |
| POST | `/api/batch/:id/submit` | Submit batch to OpenAI or Anthropic |
| GET | `/api/batch/:id/status` | Poll batch status |
| POST | `/api/batch/:id/process` | Process completed batch output |
| POST | `/api/batch/:id/retry` | Retry from failed batch requests |
| POST | `/api/translate/:id/process` | Process a changes session (real-time) |
| POST | `/api/translate/:id/finalize` | Trigger git forge output for a session |
| POST | `/api/git/finalize` | Trigger git forge output (upload sessions) |
| GET | `/api/sessions/:id/output` | Download all translated files as JSON |

### Dashboard

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sessions` | List sessions (filterable) |
| GET | `/api/sessions/:id` | Session detail |
| DELETE | `/api/sessions/:id` | Delete session |
| GET | `/api/batch` | List batch jobs |
| GET | `/api/batch/:id` | Batch detail |
| DELETE | `/api/batch/:id` | Delete batch |
| POST | `/api/batch/:id/process` | Dashboard-triggered batch process |
| GET | `/api/git/ready` | Sessions ready for forge output |
| GET | `/api/git/:senderId/status` | PR/MR/webhook status |
| GET | `/api/overview` | Dashboard counts |
| GET | `/api/pipeline/:senderId/events` | Pipeline event log |
| GET | `/api/pipeline/:senderId/logs` | AI API request log |
| POST | `/api/pipeline/:senderId/cancel` | Cancel pending jobs |
| POST | `/api/pipeline/:senderId/restart` | Restart pipeline |
| GET | `/api/sse/:senderId` | SSE event stream |

### Config / Auth

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/check` | Is auth required? |
| POST | `/api/auth/validate` | Validate access key |
| GET | `/api/settings` | All settings (sensitive values masked) |
| PUT | `/api/settings` | Update settings (ignores masked values) |

---

## Job Queue

In-process queue using the yt-automation pattern. State on `globalThis.__autoI18nQueue__`. Backed by `jobs` SQLite table.

| Job type | Triggered by | Does |
|---|---|---|
| `batch-poll` | After batch submit | Polls OpenAI/Anthropic every 30s; re-queues with delay until done |
| `batch-process` | After batch completes | Parses output, saves translations to `files` table |
| `git-finalize` | After translations complete | Runs forge workflow (branch → commits → PR/MR/webhook/none) |
| `stats-update` | After session changes | Recalculates overview counts |
| `cleanup` | Hourly | Removes expired sessions and orphaned jobs |

Zombie recovery in `00.bootstrap.ts`: flip `running` jobs with stale `heartbeat_at` (>5 min) back to `pending`.

---

## SSE

Nitro `createEventStream` (from `h3`). Pub/sub on `globalThis.__autoI18nSSE__` — a `Map<senderId, Set<EventStream>>`.

Every pipeline step publishes an event so the dashboard updates live without polling.

---

## UI / Dashboard

Single page at `pages/index.vue`. Tab layout with keyboard shortcuts.

### Tabs

| Tab | Key | Content |
|---|---|---|
| Sessions | Alt+1 | List of upload/changes sessions with status and actions |
| Batches | Alt+2 | Batch jobs with progress, process/retry actions |
| Translations | Alt+3 | Per-session locale matrix (completion %) |
| Git | Alt+4 | Sessions with open PRs/MRs; sessions ready to finalize; forge mode indicator |
| Settings | Alt+5 | All settings including prompts, provider keys, forge config |

### Git tab forge awareness

The Git tab label adapts to the configured forge: shows "GitHub" / "GitLab" / "Webhook" / "Output" depending on `GIT_FORGE`. For webhook/none modes it shows "Download" instead of PR URLs.

---

## Translation Pipeline

### Upload flow

```
CI POST /api/translate/upload
  → create/find session (type='upload')
  → save files to DB (files table, type='upload')
  → optionally: enqueueJob('batch-create') if batch mode

CI POST /api/batch
  → create batch JSONL from upload files
  → save to DB (batches table)

CI POST /api/batch/:id/submit
  → submit to OpenAI or Anthropic Batch API
  → enqueueJob('batch-poll', { batchId })

queue 'batch-poll'  (runs every 30s until done)
  → check external batch status
  → on complete: enqueueJob('batch-process')

queue 'batch-process'
  → parse output
  → save translations to DB (files table, type='translation')
  → enqueueJob('git-finalize')

queue 'git-finalize'
  → load forge from settings
  → run forge workflow (branch → commits → PR/MR/webhook/nothing)
  → save result to git_jobs table
  → publish SSE event
```

### Changes (delta) flow

```
CI POST /api/translate/changes
  → create session (type='changes')
  → save delta files to DB (type='delta')

CI POST /api/translate/:id/process
  → translate files via OpenRouter (real-time) or batch
  → save results to DB

CI POST /api/translate/:id/finalize
  → run forge workflow
```

---

## Nuxt Config

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-04-20',
  ssr: false,
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    externals: { external: ['better-sqlite3'] },
    rollupConfig: { external: ['better-sqlite3'] },
  },
})
```

---

## Drizzle Config

```ts
export default defineConfig({
  schema: './server/db/schema.ts',
  out:    './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './tmp/auto-i18n.sqlite' },
})
```

---

## Deployment

### Development
```bash
bun install
bun run dev
```

### Production
```bash
bun run build
node .output/server/index.mjs
```

SQLite file at `tmp/auto-i18n.sqlite` is created automatically. Migrations run at boot.

### Docker (single container)
```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install && bun run build
VOLUME ["/app/tmp"]
CMD ["node", ".output/server/index.mjs"]
```

No separate database container.

---

## Intentional Removals

| Removed | Reason |
|---|---|
| `client/` directory | Replaced by Nuxt pages + components |
| ElysiaJS | Replaced by Nitro |
| `docker-compose.yml` with PostgreSQL | SQLite eliminates DB container |
| `tmp/` filesystem for content | DB-only storage |
| `tmp/logs/api-responses-*.json` | Replaced by `api_request_logs` table |
| Winston logger | Nitro's built-in console + `useLogger` |
| `server/cache/` LRU module | Not needed; settings cached via singleton |
| `translation_stats` table | Counts computed live from sessions |
| Separate `tsconfig.app.json` / `tsconfig.node.json` | Nuxt manages TS config |
| DeepSeek provider | Available through OpenRouter |
| Hardcoded 32-locale allowlist | Any valid locale code accepted |
| GitHub label auto-creation | Removed entirely |
| OpenRouter, Anthropic, DeepSeek real-time providers | Collapsed into single OpenRouter provider |
| `NoOpTranslationProvider` | Replaced by an explicit "no provider configured" check |

---

## Build Order

1. **Project scaffold** — `bunx nuxi init`, configure `nuxt.config.ts`, install deps
2. **DB layer** — sqlite singleton, Drizzle schema, proxy, bootstrap plugin, `drizzle.config.ts`
3. **Settings** — `settings` table, `getSetting()` utility, settings GET/PUT routes
4. **Auth** — middleware, check + validate routes
5. **Locales** — format validation, `Intl.DisplayNames` resolver
6. **Sessions** — schema + repository + CRUD routes
7. **Files** — schema + repository + file save/read helpers + output download route
8. **Translation prompts** — `prompts.ts` loader with locale substitution, defaults seeded to DB on bootstrap
9. **OpenRouter provider** — real-time translation (markdown + JSON)
10. **StaggeredRequestQueue** — port from v1
11. **Real-time translate flow** — unified upload endpoint → translate → save to DB
12. **OpenAI Batch provider** — batch create/submit/poll/process
13. **Anthropic Batch provider** — same interface, Anthropic Message Batches API
14. **Batch flow** — batch routes + queue jobs
15. **Changes flow** — delta upload + process + finalize routes
16. **Git forge abstraction** — interface + GitHub implementation + GitLab implementation
17. **Webhook forge** — POST translated files to callback URL
18. **None forge** — no-op + output download route
19. **Git workflow** — forge-agnostic branch → commits → PR/MR/webhook logic
20. **Job queue** — in-process queue with SQLite backing + batch-poll loop
21. **SSE** — pub/sub on globalThis, createEventStream handler
22. **Pipeline events + API logs** — record every step, expose via routes
23. **Dashboard UI** — pages, tab components, composables, shadcn-vue setup
24. **Settings tab** — live config editing including prompts
25. **Git tab** — forge-aware UI (GitHub/GitLab/Webhook/None modes)
26. **Polish** — keyboard shortcuts, error states, loading states
27. **Validation** — test all CI flows end-to-end, compare output with v1
