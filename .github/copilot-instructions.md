# Auto-i18n Copilot Guide

## Startup & tooling

- **Runtime**: Bun v1.3.0+; install deps with `bun install`.
- **Database**: PostgreSQL 18.1 + DragonflyDB (Redis-compatible). Start with `bun run docker:up`.
- **Migrations**: Run `bun run db:generate` to generate migrations, `bun run db:migrate` to apply them.
- **API Server**: Run with `bun run dev` (uses `--hot` flag for hot reload). ElysiaJS listens on port 3000 by default (configurable via `PORT` env var).
- **Vue Dashboard**: Run with `bun run client` (Vite dev server on port 5173).
- **Routes**: Live under `server/routes`; add new endpoints by registering them in `routes/index.ts`. Use ElysiaJS patterns for route definitions.
- **Type Safety**: Return `FileUploadResponse`/`ErrorResponse` shapes from `server/types/api.ts` for consistent API responses.

## Architecture snapshot

### Backend (ElysiaJS)

- `server/index.ts` boots an ElysiaJS app with CORS support, authentication middleware, database initialization, and queue workers.
- **Database Layer**: `server/database/` provides Drizzle ORM (`connection.ts`), schema definitions (`schema.ts`), and Redis (`redis.ts`) connections.
- **Repositories**: `server/repositories/` provides data access layer using Drizzle ORM for `sessions`, `files`, `batches`, `translation_jobs`.
- **Cache**: `server/cache/` provides caching utilities, pub/sub, and distributed locks using Redis.
- **Queues**: `server/queues/` provides BullMQ job queues with DragonflyDB backend for async processing.
- Auth routes (`/api/auth/*`) are mounted first and are not protected.
- `authMiddleware` protects all other routes when `ACCESS_KEY` is set in environment.
- Route modules are grouped: `content`, `global`, `page`, `batch`, `github`, `dashboard`.

### Database Architecture

- **PostgreSQL**: Primary data store for sessions, files, batches, translation jobs.
- **Drizzle ORM**: Type-safe database layer with schema in `server/database/schema.ts`.
- **DragonflyDB**: Redis-compatible cache and queue backend (runs with `--cluster_mode=emulated --lock_on_hashtags` for BullMQ optimization).
- **BullMQ**: Job queue for async processing (batch polling, output processing, GitHub finalization).
- **Migrations**: Managed by Drizzle Kit in `server/database/migrations/`.

### Frontend (Vue 3)

- **Dashboard**: `client/components/DashboardLayout.vue` hosts tabs for Uploads, Batches, Translations, and GitHub.
- **Composables**: Reusable logic in `client/composables/`:
  - `useAuth` - Authentication state management
  - `useBatches` - Batch operations and state
  - `useTranslations` - Translation session management
  - `useGitHub` - GitHub PR operations
  - `useUploads` - Upload session management
  - `useRefreshInterval` - Auto-refresh with pause/resume
  - `useErrorBoundary` - Centralized error handling
  - `useKeyboardShortcuts` - Keyboard navigation
- **API Client**: `client/lib/api-client.ts` handles all HTTP requests with automatic access key injection.
- **Components**: Use shadcn-vue components from `client/components/ui/` for consistent styling.
- **Icons**: Use lucide-vue-next icons throughout the UI.

## Translation pipeline

### Real-time Translation

- Translation triggers (`POST /content/translate`, `/global/translate`, `/page/translate`) read saved uploads.
- `translateContentFiles`/`translateGlobalFile`/`translatePageFiles` write results to `tmp/<senderId>/translations/<targetLocale>/<type>`.
- `services/translation/providers.ts` selects an adapter via `getTranslationConfig()`.
- All provider adapters push work through `StaggeredRequestQueue` to throttle LLM calls.

### Batch Translation (OpenAI Only)

- **Create**: `POST /translate/batch` - Creates batch JSONL file from uploads.
- **Submit**: `POST /translate/batch/{batchId}/submit` - Submits to OpenAI Batch API.
- **Status**: `GET /translate/batch/{batchId}/status` - Polls batch status.
- **Process**: `POST /translate/batch/{batchId}/process` - Processes completed batch output.
- **Retry**: `POST /translate/batch/retry` - Creates new batch from failed requests.
- Batch files stored in `tmp/<senderId>/batches/<batchId>/` with `input.jsonl`, `manifest.json`, and output files.
- Use `services/translation/openaiBatchService.ts` for batch operations.
- Use `services/translation/batchOutputProcessor.ts` to parse and save batch results.

## Provider configuration

- **Primary Provider**: Set via `TRANSLATION_PROVIDER` env var (`openai`, `anthropic`, `deepseek`).
- **Provider Configs**: Each provider expects its own env vars:
  - OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL` (default: `gpt-4o-mini`), optional `OPENAI_API_URL`
  - Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default: `claude-3-5-haiku-20241022`), optional `ANTHROPIC_API_URL`
  - DeepSeek: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default: `deepseek-chat`), optional `DEEPSEEK_API_URL`
- **Fallback**: If no API key is available, the fallback provider returns empty results and logs a warning.
- **Provider Files**: Individual adapters in `services/translation/providers/` (`openaiProvider.ts`, `anthropicProvider.ts`, `deepseekProvider.ts`).
- **API Logging**: Responses mirrored to `tmp/logs/api-responses-*.json` via `utils/apiResponseLogger`.

## Dashboard API

RESTful endpoints for dashboard UI (`server/routes/dashboard.ts`):

- **Stats**: `GET /api/stats` - System-wide statistics
- **Uploads**: `GET /api/uploads` - List upload sessions with filtering
- **Upload Details**: `GET /api/uploads/:senderId` - Detailed upload info
- **Delete Upload**: `DELETE /api/uploads/:senderId` - Remove upload session
- **Batches**: `GET /api/batches` - List all batches with status
- **Batch Details**: `GET /api/batches/:batchId` - Batch info and manifest
- **Delete Batch**: `DELETE /api/batches/:batchId` - Remove batch
- **Translations**: `GET /api/translations` - List translation sessions
- **Translation Status**: `GET /api/translations/:senderId` - Translation progress matrix
- **GitHub Ready**: `GET /api/github/ready` - Sessions ready for PR creation
- **Files**: `GET /api/files` - List files with filtering

All dashboard endpoints use helper functions from `utils/dashboardUtils.ts`.

## GitHub synchronization

- **Finalize**: `POST /github/finalize` calls `services/github/workflow.finalizeTranslationJob`.
- Workflow: Loads metadata → Creates issue → Creates branch → Seed commit → Translation commit → Opens PR.
- Target repo paths derived from `TranslationFileDescriptor`; override with `targetPathPattern`/`translationTempPathPattern`.
- **Credentials**: `AUTO_I18N_GITHUB_TOKEN` (or `GITHUB_TOKEN`), optional `AUTO_I18N_GITHUB_API_URL`, `AUTO_I18N_GITHUB_APP_NAME`.
- **Dry-run**: Set `dryRun: true` to validate metadata without creating PR.

## Authentication

- **Optional**: Set `ACCESS_KEY` in environment to enable authentication.
- **Middleware**: `authMiddleware` in `server/middleware/auth.ts` protects all routes except `/` and `/api/auth/*`.
- **Check**: `GET /api/auth/check` - Returns whether auth is required.
- **Validate**: `POST /api/auth/validate` - Validates provided access key.
- **Client**: Access key stored in localStorage, sent via `X-Access-Key` header or `?access_key=` query param.

## Testing

### Backend Tests (Bun)

- Location: `tests/server/**/*.test.ts`
- Run: `bun run test:backend` or `bun test`
- Coverage: Middleware, routes, services, utilities, configuration
- Framework: Bun's built-in test runner
- Pattern: `describe()` + `it()` + `expect()`

### Frontend Tests (Vitest)

- Location: `tests/client/**/*.test.ts`
- Run: `bun run test:frontend`
- Coverage: Components, composables, API client
- Framework: Vitest with @vue/test-utils
- Environment: happy-dom
- Pattern: `describe()` + `it()` + `expect()` + `mount()`

## Logging & conventions

- **Scoped Logger**: Use `createScopedLogger('scope:name')` from `utils/logger.ts` for structured logging.
- **Log Files**: Logs stream to stdout and `tmp/logs/latest.log` (configurable via env).
- **Request Sanitization**: Sanitize inbound metadata through helpers in routes (see `sanitizeHeaders` pattern).
- **Locales**: Add new locales to `config/locales.SUPPORTED_LOCALES`; helpers like `isSupportedLocale` depend on this list.
- **Error Handling**: Use try-catch with proper error logging; return standardized `ErrorResponse` shapes.
- **Type Safety**: Leverage TypeScript throughout; import types from `server/types` and `client/types`.

## Database Schema

### Main Tables (PostgreSQL)

- **sessions**: Upload/change sessions with repository & locale info
- **translation_jobs**: Individual jobs within sessions
- **files**: All file types (upload, translation, delta, original) with content stored as TEXT
- **batches**: OpenAI batch jobs with manifest as JSONB
- **batch_requests**: Individual requests within batches
- **translation_stats**: Dashboard statistics

### Repository Pattern

Use repositories in `server/repositories/` for all database operations:

```typescript
import { createSession, getSessionBySenderId } from '../repositories'

// Create session
const session = await createSession({
  senderId: 'my-sender',
  sessionType: 'upload',
  sourceLocale: 'en',
})

// Query session
const existing = await getSessionBySenderId('my-sender')
```

### Cache Pattern

Use cache utilities in `server/cache/` for caching and pub/sub:

```typescript
import { cacheGet, cacheSet, publish, Channels } from '../cache'

// Cache data
await cacheSet('key', data, 300) // 5 minute TTL
const cached = await cacheGet('key', true) // parse JSON

// Publish events
await publish(Channels.batchCompleted, { batchId, status: 'completed' })
```

### Queue Pattern

Use BullMQ queues in `server/queues/` for async processing:

```typescript
import { addBatchPollJob, addGitHubFinalizeJob } from '../queues'

// Add polling job with delay
await addBatchPollJob({ batchId, senderId, openaiBatchId }, { delay: 30000 })

// Add finalization job
await addGitHubFinalizeJob({ senderId, sessionId })
```

## File Storage Structure (Legacy - Being Migrated to Database)

```text
tmp/
└── {senderId}/
    ├── metadata.json              # Job metadata
    ├── uploads/
    │   └── {locale}/              # Source locale
    │       ├── content/           # Markdown files
    │       ├── global/            # Global JSON translations
    │       └── page/              # Page-specific JSON translations
    ├── batches/
    │   └── {batchId}/
    │       ├── input.jsonl        # Batch input requests
    │       ├── manifest.json      # Batch metadata
    │       ├── {batch_id}_output.jsonl   # OpenAI output
    │       └── {batch_id}_error.jsonl    # OpenAI errors
    └── translations/
        └── {targetLocale}/        # Target locale
            ├── content/           # Translated markdown
            ├── global/            # Translated global JSON
            └── page/              # Translated page JSON
```

## Key Dependencies

**Backend:**

- ElysiaJS, @elysiajs/cors, drizzle-orm, openai, @anthropic-ai/sdk, winston, zod

**Frontend:**

- Vue 3, Vite, Tailwind CSS v4, shadcn-vue (reka-ui), lucide-vue-next, @vueuse/core

**Testing:**

- Bun (backend), Vitest + @vue/test-utils (frontend)

**Runtime:**

- Bun v1.3.0+
- Use bunx and other bun commands when needed.

## Common Tasks

### Add a new route

1. Create route file in `server/routes/{name}.ts` using ElysiaJS patterns
2. Register in `server/routes/index.ts`: `routes.use(yourRoutes)`
3. Define response types in `server/types/api.ts`

### Add a new translation provider

1. Create provider file in `services/translation/providers/{provider}Provider.ts`
2. Implement `TranslationProvider` interface
3. Add provider config to `config/env.ts`
4. Update `providers.ts` to include new provider

### Add a new dashboard tab

1. Create component in `client/components/{Name}Tab.vue`
2. Add composable in `client/composables/use{Name}.ts` if needed
3. Register tab in `DashboardLayout.vue`
4. Add API endpoints in `server/routes/dashboard.ts`

### Debug translations

1. Check `tmp/logs/api-responses-*.json` for raw AI provider responses
2. Check `tmp/logs/latest.log` for structured logs
3. Enable debug logging in provider files if needed
4. Verify batch manifest in `tmp/{senderId}/batches/{batchId}/manifest.json`
