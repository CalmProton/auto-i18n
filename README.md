# Auto-i18n

Auto-i18n receives localization artifacts from CI pipelines, stores them in a temporary workspace, runs machine translation, and now loops changes back to the source repository via the GitHub API.

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
