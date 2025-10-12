# Auto-i18n Copilot Guide

## Startup & tooling

- Runtime is Bun; install deps with `bun install` and run the API with `bun run --hot server/index.ts` (Hono listens on port 3000 by default).
- Routes live under `server/routes`; add new endpoints by registering them in `routes/index.ts` and returning `FileUploadResponse`/`ErrorResponse` shapes from `server/types`.

## Architecture snapshot

- `server/index.ts` boots a Hono app and mounts grouped route modules (`content`, `global`, `page`, `github`).
- Upload handlers call `services/fileProcessor` to persist files under `tmp/<senderId>/uploads/<locale>/<type>` and enqueue translation triggers via `services/translation/*`.
- `utils/fileValidation` parses multipart payloads, validates locales via `config/locales`, and normalizes folder structure (see `deriveFolderInfoFromField`).
- Metadata from requests is merged with `tmp/<senderId>/metadata.json` through `utils/metadataInput` and `utils/jobMetadata`; always keep descriptor counts aligned with the actual uploads.

## Translation pipeline

- Translation triggers (`routes/*/trigger`) read saved uploads, then `translateContentFiles`/`translateGlobalFile`/`translatePageFiles` write results to `tmp/<senderId>/translations/<targetLocale>/<type>` using `saveTextToTemp`.
- `services/translation/providers.ts` selects an adapter via `getTranslationConfig()`; if no API key is available, the fallback provider returns empty results and logs a warning.
- All provider adapters push work through `StaggeredRequestQueue` to throttle LLM calls; reuse it for any new provider integrations.

## Provider configuration

- Control the primary provider with `TRANSLATION_PROVIDER` (`openai`, `anthropic`, `deepseek`).
- Each provider expects its key/model/url env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.); defaults are `gpt-5-mini`, `claude-3-haiku-20240307`, and `deepseek-chat`.
- API responses are mirrored into `tmp/logs/api-responses-*.json` via `utils/apiResponseLogger`—inspect these when debugging translations.

## GitHub synchronization

- `/github/finalize` calls `services/github/workflow.finalizeTranslationJob`, which loads metadata, ensures required labels, creates/updates the branch, and generates per-locale seed + translation commits before opening the PR.
- Target repo paths come from each `TranslationFileDescriptor`; if heuristics misbehave, provide `targetPathPattern` / `translationTempPathPattern` via metadata.
- GitHub credentials and base URL come from `config/github` (`AUTO_I18N_GITHUB_TOKEN`, optional `AUTO_I18N_GITHUB_API_URL`, `AUTO_I18N_GITHUB_APP_NAME`).

## Logging & conventions

- Use `createScopedLogger` for structured logging; logs stream to stdout and to `tmp/logs/latest.log` (path configurable by env).
- Sanitize inbound request metadata through helpers already in the routes (e.g., `sanitizeHeaders` in `routes/content.ts`); extend these patterns rather than introducing ad-hoc logging.
- When adding locales, update `config/locales.SUPPORTED_LOCALES`; downstream helpers (`isSupportedLocale`, metadata extractors) depend on that list.
