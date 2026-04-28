# Auto-i18n Agent Guide

## Overview

Auto-i18n v2 is a single Nuxt 4 application (SPA + Nitro server) that automates i18n translation workflows. It replaces the old v1 ElysiaJS + Vue SPA + PostgreSQL architecture with a unified Nuxt 4 project using SQLite (`better-sqlite3`) for zero-setup storage.

## Startup & Tooling

- **Runtime**: Bun v1.3.0+
- **Install deps**: `bun install`
- **Dev server**: `bun run dev` — starts Nuxt dev server (frontend + Nitro API on same port)
- **Production build**: `bun run build`
- **DB migrations**: `bun run db:generate` / `bun run db:migrate`
- **DB explorer**: `bun run db:studio`
- **Typecheck**: `bun run typecheck`
- **Lint**: `bun run lint` / `bun run lint:fix`
- **Format**: `bun run format` / `bun run format:check`

No Docker required. SQLite DB is auto-created at `tmp/auto-i18n.sqlite` on first boot.

## Architecture

### Stack

- **Nuxt 4** (`future: { compatibilityVersion: 4 }`) — SPA (`ssr: false`)
- **Nitro** — API routes under `server/api/`
- **SQLite** via `better-sqlite3` + **Drizzle ORM** (`server/db/`)
- **Tailwind CSS v4** via `@tailwindcss/vite` (no config file)
- **Reka UI** for headless components
- **Bun** as runtime and package manager

### Directory Layout

```
auto-i18n/
├── app/                        # Nuxt frontend (srcDir)
│   ├── app.vue                 # Root component
│   ├── assets/css/main.css     # Tailwind entry
│   ├── components/
│   │   ├── tabs/               # OverviewTab, SessionsTab, SettingsTab
│   │   ├── session/            # SessionRow, SessionFiles, SessionEvents, etc.
│   │   └── ui/                 # StatusBadge, SettingField
│   ├── composables/
│   │   └── useSSE.ts           # Server-Sent Events composable
│   └── pages/
│       ├── index.vue           # Tabbed dashboard shell
│       └── sessions/[id].vue   # Session detail page
├── server/
│   ├── api/                    # Nitro route handlers
│   │   ├── auth/status.get.ts
│   │   ├── settings.get.ts / settings.put.ts
│   │   ├── sessions/           # list, get, delete
│   │   ├── translate/          # upload.post.ts, changes.post.ts
│   │   ├── batch/              # get, submit
│   │   ├── git/                # get, trigger
│   │   ├── pipeline/           # events, logs
│   │   ├── sse/[senderId].get.ts
│   │   ├── overview.get.ts
│   │   └── files/              # list, get
│   ├── db/
│   │   ├── sqlite.ts           # globalThis singleton connection
│   │   ├── schema.ts           # Drizzle schema (sessions, files, batches, events, logs, settings)
│   │   ├── index.ts            # Re-exports db + schema
│   │   └── migrations/         # SQL migration files
│   ├── middleware/
│   │   └── auth.ts             # Optional ACCESS_KEY protection
│   ├── plugins/
│   │   └── 00.bootstrap.ts     # Runs migrations + seeds settings on startup
│   ├── queue/
│   │   └── index.ts            # globalThis job queue (realtime-translate, batch-poll, batch-process, git-finalize, cleanup)
│   ├── repositories/           # Data access layer (sessions, files, batches, events, logs)
│   ├── services/
│   │   ├── translation/        # OpenRouter (realtime), OpenAI batch, Anthropic batch, mock, prompts
│   │   └── git/                # GitHub, GitLab, webhook, none forges + workflow.ts
│   └── utils/
│       ├── auth.ts             # requireAuth helper
│       ├── getSetting.ts       # Read settings from DB
│       ├── locales.ts          # BCP-47 validation + display names
│       └── sse.ts              # SSE stream registry (globalThis)
├── nuxt.config.ts
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

## Database

- **SQLite** at `tmp/auto-i18n.sqlite` (gitignored, auto-created)
- **Schema** in `server/db/schema.ts` — tables: `sessions`, `files`, `batches`, `events`, `logs`, `settings`
- **Migrations** in `server/db/migrations/` — applied automatically on boot via `server/plugins/00.bootstrap.ts`
- **Drizzle ORM** for all queries — never raw SQL

### Key Tables

| Table | Purpose |
|---|---|
| `sessions` | Upload/changes translation sessions |
| `files` | File content (upload, translation, delta) |
| `batches` | OpenAI/Anthropic batch jobs |
| `events` | Pipeline events per session |
| `logs` | Raw log lines per session |
| `settings` | Runtime-editable key/value config |

## Translation Pipeline

### Real-time (OpenRouter)
- `POST /api/translate/upload` or `/api/translate/changes` → creates session → enqueues `realtime-translate` job
- Job calls OpenRouter API with selected model
- Progress streamed via SSE at `GET /api/sse/:senderId`

### Batch (50% cost savings, async)
- Submit: `POST /api/batch/:sessionId/submit` → sends to OpenAI Batch API or Anthropic Message Batches
- Poll: queue runs `batch-poll` jobs every 60s until complete
- Process: `batch-process` job writes translations back to DB

### Git Forge (delivery)
- After translation: `git-finalize` job pushes translated files to the configured forge
- `GIT_FORGE` setting: `github` | `gitlab` | `webhook` | `none`
- GitHub: creates branch + commits + PR via raw fetch (no Octokit)
- GitLab: creates branch + commits + MR via GitLab API
- Webhook: POSTs translated files to `WEBHOOK_URL`
- None: translations stored in DB only, retrievable via `GET /api/files/:sessionId`

## Providers

### Real-time
- **OpenRouter** (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`) — single key covers all models

### Batch
- **OpenAI** (`OPENAI_API_KEY`, `OPENAI_BATCH_MODEL`) — OpenAI Batch API (async, 50% discount)
- **Anthropic** (`ANTHROPIC_API_KEY`, `ANTHROPIC_BATCH_MODEL`) — Message Batches API
- `BATCH_PROVIDER=auto` picks whichever has a key set

### Mock
- `MOCK_MODE=true` — skips all LLM calls, returns placeholder translations

## API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/status` | Auth required? |
| GET | `/api/settings` | List all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/:id` | Session detail |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/translate/upload` | Upload files for translation |
| POST | `/api/translate/changes` | Submit changed files for translation |
| GET | `/api/batch/:sessionId` | Batch status |
| POST | `/api/batch/:sessionId/submit` | Submit batch job |
| GET | `/api/git/:sessionId` | Git forge status |
| POST | `/api/git/:sessionId/trigger` | Manually trigger git finalize |
| GET | `/api/pipeline/:sessionId/events` | Session events |
| GET | `/api/pipeline/:sessionId/logs` | Session logs |
| GET | `/api/sse/:senderId` | SSE stream |
| GET | `/api/overview` | Dashboard stats |
| GET | `/api/files/:sessionId` | List files for session |
| GET | `/api/files/:sessionId/:fileId` | Get file content |

## Authentication

- Optional: set `ACCESS_KEY` in `.env` to require auth
- Header: `X-Access-Key: <key>` or query `?access_key=<key>`
- `server/middleware/auth.ts` protects all routes except `/api/auth/*`

## Settings (runtime-editable)

All settings seeded in `settings` table, editable via UI or `PUT /api/settings`:

| Key | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key |
| `OPENROUTER_MODEL` | Model slug |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_BATCH_MODEL` | OpenAI batch model |
| `ANTHROPIC_API_KEY` | Anthropic key |
| `ANTHROPIC_BATCH_MODEL` | Anthropic batch model |
| `BATCH_PROVIDER` | `auto` / `openai` / `anthropic` |
| `GIT_FORGE` | `github` / `gitlab` / `webhook` / `none` |
| `GITHUB_TOKEN` | GitHub PAT |
| `GITHUB_API_URL` | GitHub API base |
| `GIT_CREATE_ISSUES` | `true` / `false` |
| `GITLAB_TOKEN` | GitLab PAT |
| `GITLAB_API_URL` | GitLab API base |
| `WEBHOOK_URL` | Webhook delivery URL |
| `WEBHOOK_SECRET` | Webhook HMAC secret |
| `TRANSLATE_PROMPT` | System prompt for translation |
| `MOCK_MODE` | `true` / `false` |

## Job Queue

- `server/queue/index.ts` — globalThis singleton, survives Nitro HMR
- `bootRecover()` — on startup, re-queues any stuck `processing` jobs
- `enqueueJob(type, payload, opts?)` — add job with optional delay + maxAttempts
- Exponential backoff on failure (base 5s, max 5 min)
- Job types: `realtime-translate`, `batch-poll`, `batch-process`, `git-finalize`, `cleanup`

## SSE (Server-Sent Events)

- `server/utils/sse.ts` — globalThis stream registry
- Frontend subscribes via `GET /api/sse/:senderId`
- Events pushed from queue jobs as translation progresses

## Conventions

- **No `~/` imports in `.vue` files** — Nuxt 4 `srcDir` is `app/`, so `~` resolves to `app/`. Use relative imports or Nuxt auto-imports.
- **No raw SQL** — all DB access via Drizzle ORM through repositories
- **globalThis pattern** — SQLite connection, SSE registry, and job queue all use `globalThis` to survive HMR
- **Bun runtime** — use `bun`, `bunx`; never npm/yarn/pnpm
- **TypeScript strict** — no `any`; use `unknown` and narrow
- **Error handling** — use `createError()` in Nitro handlers; catch with `unknown`

## Common Tasks

### Add a new API route
1. Create `server/api/<path>.<method>.ts`
2. Use `defineEventHandler`, `readBody`, `getRouterParam` from `h3`
3. Auth check via `requireAuth(event)` from `~/server/utils/auth`

### Add a new setting
1. Add seed entry in `server/plugins/00.bootstrap.ts`
2. Add UI field in `app/components/tabs/SettingsTab.vue`
3. Read it via `getSetting(key)` from `server/utils/getSetting.ts`

### Add a new git forge
1. Implement `GitForge` interface in `server/services/git/`
2. Register in `server/services/git/workflow.ts` forge selector

### Add a new translation provider
1. Implement provider in `server/services/translation/`
2. Wire into `server/queue/index.ts` job handlers
