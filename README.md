# Auto-i18n

Auto-i18n receives localization artifacts from CI pipelines, stores them in a temporary workspace, runs machine translation, and now loops changes back to the source repository via the GitHub API.

## Quick Start

### Start the API Server

```bash
bun run dev
```

The API server runs on `http://localhost:3000` (configurable via `PORT` environment variable).

### Start the Vue Client (Optional)

For a web-based interface to interact with the API:

```bash
bun run client
```

The Vue client runs on `http://localhost:5173` and provides an intuitive interface for uploading files, triggering translations, checking batch status, and creating GitHub pull requests.

**Tech Stack:**
- Vue 3 with Composition API
- Tailwind CSS v4
- shadcn-vue components
- Full TypeScript support

See [`client/README.md`](./client/README.md) for more details and [`client/TAILWIND_SETUP.md`](./client/TAILWIND_SETUP.md) for UI customization.

## OpenAI batch translation

Use the batch endpoints to prepare large translation jobs for OpenAI's asynchronous Batch API (50% discounted pricing, 24-hour SLA).

### Prepare a batch input file

```http
POST /translate/batch
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "sourceLocale": "en",
  "targetLocales": ["fr", "de"],
  "includeFiles": ["blog/logo-remover-guide.md"]
}
```

This call collects saved uploads under `tmp/<senderId>/uploads/<sourceLocale>/{content,global,page}`, generates `input.jsonl`, and writes a manifest to `tmp/<senderId>/batches/<batchId>/`.

Set `types` to `"all"` (default) or a subset such as `"types": ["content", "global"]` to control which upload categories are included. Provide `includeFiles` entries as either raw relative paths (`"blog/post.md"`) or type-prefixed paths (`"global/en.json"`, `"page/home/en.json"`).

### Submit the batch to OpenAI

```http
POST /translate/batch/<batchId>/submit
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "metadata": {
    "job": "nightly-content"
  }
}
```

The service uploads the JSONL file via OpenAI's Files API, creates the batch, and stores the API responses alongside the manifest for later status checks and result retrieval.

## GitHub synchronization

### Environment variables

Set the following variables in the runtime environment (for Bun this can live in `.env`):

| Variable | Description |
| --- | --- |
| `AUTO_I18N_GITHUB_TOKEN` (or `GITHUB_TOKEN`) | Personal access token or GitHub App installation token with `repo` scope. |
| `AUTO_I18N_GITHUB_API_URL` | Optional. Override the GitHub API base URL (defaults to `https://api.github.com`). |
| `AUTO_I18N_GITHUB_APP_NAME` | Optional. Custom user agent used for API requests. |

### Finalizing a translation job

Once uploads and translations are ready under `tmp/<senderId>`, trigger the GitHub workflow:

```http
POST /github/finalize
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "dryRun": false,
  "metadata": {
    "repository": {
      "owner": "owner",
      "name": "repo",
      "baseBranch": "main",
      "baseCommitSha": "<full commit sha>"
    },
    "sourceLocale": "en",
    "targetLocales": ["ru", "zh"],
    "files": [
      {
        "type": "global",
        "sourceTempRelativePath": "en.json",
        "repositorySourcePath": "i18n/locales/en.json"
      },
      {
        "type": "page",
        "sourceTempRelativePath": "account/en.json",
        "repositorySourcePath": "i18n/page/account/en.json"
      },
      {
        "type": "content",
        "sourceTempRelativePath": "blog/logo-remover-guide.md",
        "repositorySourcePath": "content/en/blog/logo-remover-guide.md"
      }
    ],
    "issue": {
      "title": "Translate English resources to Russian and Chinese"
    },
    "pullRequest": {
      "title": "Add ru & zh translations",
      "baseBranch": "main"
    },
    "branch": {
      "prefix": "auto-i18n"
    }
  }
}
```

Key notes:

- `senderId` must match the identifier used during uploads (temporary files are looked up under `tmp/<senderId>`).
- `sourceTempRelativePath` is resolved relative to `tmp/<senderId>/uploads/<sourceLocale>/<type>`.
- `repositorySourcePath` points to the original file in the upstream repository and is used to derive target paths. When the default heuristics are not sufficient, provide `targetPathPattern` (using `:locale` and `:sourceLocale` placeholders) and/or `translationTempPathPattern` on a per-file basis.
- The service stores the merged metadata at `tmp/<senderId>/job.metadata.json` so subsequent calls can omit repeated fields.
- Set `dryRun` to `true` to validate metadata without touching GitHub.

The workflow will:

1. Create a GitHub issue summarizing the translation request.
2. Create a feature branch from the supplied base commit.
3. Commit original source files duplicated into each target locale (seed commit).
4. Overwrite the seeded files with translated content (translation commit).
5. Open a pull request targeting the base branch and referencing the created issue.

If no changes are detected, the call fails early instead of creating an empty pull request.
