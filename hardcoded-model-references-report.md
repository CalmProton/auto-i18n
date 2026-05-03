# Hardcoded Model References — auto-i18n

> Generated 2026-05-03 | Well-structured settings hierarchy. Low priority.

---

## LLM Models — Fallback Defaults

auto-i18n has a **settings-based system** with hardcoded fallbacks in a `DEFAULTS` map. The provider-level `??` chains mirror the defaults.

| # | File | Line | Hardcoded Value | Setting Key |
|---|---|---|---|---|
| 1 | `server/utils/getSetting.ts` | 118 | `'openai/gpt-4o-mini'` | `OPENROUTER_MODEL` |
| 2 | `server/utils/getSetting.ts` | 119 | `'gpt-4o-mini'` | `OPENAI_BATCH_MODEL` |
| 3 | `server/utils/getSetting.ts` | 120 | `'claude-3-haiku-20240307'` | `ANTHROPIC_BATCH_MODEL` |
| 4 | `server/services/translation/providers/openrouter.ts` | 28, 55 | `'openai/gpt-4o-mini'` | Fallback after `opts.model ?? getSetting('OPENROUTER_MODEL') ??` |
| 5 | `server/services/translation/providers/openai-batch.ts` | 30 | `'gpt-4o-mini'` | Fallback after `getSetting('OPENAI_BATCH_MODEL') ??` |
| 6 | `server/services/translation/providers/anthropic-batch.ts` | 17 | `'claude-3-haiku-20240307'` | Fallback after `getSetting('ANTHROPIC_BATCH_MODEL') ??` |

---

## Assessment

This is the **most config-driven** of all projects. The fallback chain is: explicit opt → DB setting → `DEFAULTS` map → hardcoded string. The `DEFAULTS` map in `getSetting.ts` is the single source of truth for seed defaults.

## Recommended Fix

If full configurability is desired:
1. Remove the hardcoded fallback strings from provider files — let them throw if neither an explicit `opts.model` nor a DB setting is available.
2. Optionally, make the `DEFAULTS` map values themselves configurable via environment variables.
