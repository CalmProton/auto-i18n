# Auto-i18n

**Auto-i18n** is a complete translation automation platform that receives localization artifacts from CI pipelines, manages translation workflows using multiple AI providers, and creates GitHub pull requests with translated content. Built with **Bun**, **ElysiaJS**, and **Vue 3**.

## ✨ Features

- 🌍 **Multi-locale translation** with support for 40+ languages
- 🤖 **Multiple AI providers**: OpenAI, Anthropic, DeepSeek
- 📦 **Batch translation** via OpenAI Batch API (50% cost savings)
- 🎨 **Modern Vue 3 dashboard** with real-time status updates
- 🔄 **GitHub integration** for automated pull request creation
- 🔐 **Optional authentication** with access key protection
- 🧪 **Comprehensive test coverage** for backend and frontend
- ⌨️ **Keyboard shortcuts** for power users
- 🌙 **Dark mode** support

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.0 or higher
- At least one AI provider API key (OpenAI, Anthropic, or DeepSeek)
- GitHub personal access token (for GitHub integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/auto-i18n.git
cd auto-i18n

# Install dependencies
bun install
```

### Configuration

Create a `.env` file in the root directory:

```bash
# Server Configuration
PORT=3000

# Authentication (optional)
ACCESS_KEY=your-secret-key-here

# Translation Provider Configuration
TRANSLATION_PROVIDER=openai  # openai | anthropic | deepseek

# OpenAI Configuration (if using OpenAI)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini  # default: gpt-4o-mini
# OPENAI_API_URL=https://api.openai.com/v1  # optional

# Anthropic Configuration (if using Anthropic)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-haiku-20241022  # default: claude-3-5-haiku-20241022
# ANTHROPIC_API_URL=https://api.anthropic.com  # optional

# DeepSeek Configuration (if using DeepSeek)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat  # default: deepseek-chat
# DEEPSEEK_API_URL=https://api.deepseek.com  # optional

# GitHub Integration
AUTO_I18N_GITHUB_TOKEN=ghp_...
# AUTO_I18N_GITHUB_API_URL=https://api.github.com  # optional
# AUTO_I18N_GITHUB_APP_NAME=Auto-i18n  # optional
```

### Running the Application

#### Start the API Server

```bash
bun run dev
```

The API server runs on `http://localhost:3000` (configurable via `PORT` environment variable).

#### Start the Vue Dashboard (Recommended)

```bash
bun run client
```

The Vue dashboard runs on `http://localhost:5173` and provides:

- **Uploads Tab**: View and manage uploaded source files
- **Batches Tab**: Track OpenAI batch translation jobs
- **Translations Tab**: Monitor translation progress across locales
- **GitHub Tab**: Create pull requests with translated content
- **Stats Overview**: Real-time system statistics

**Keyboard Shortcuts:**

- `Alt + 1-4`: Switch between tabs
- `?`: Show keyboard shortcuts help

## 📖 Core Concepts

### File Types

Auto-i18n supports three types of localization files:

1. **Content** (`.md`): Markdown content files (blog posts, documentation)
2. **Global** (`.json`): Application-wide translation strings
3. **Page** (`.json`): Page-specific translation strings

### Workflow

1. **Upload**: Upload source locale files via API or dashboard
2. **Batch**: Create translation batch jobs (optional, for bulk processing)
3. **Translate**: Trigger AI translation to target locales
4. **Review**: View translation results in dashboard
5. **Publish**: Create GitHub PR with translated files

### Translation Providers

Auto-i18n supports three AI translation providers:

| Provider | Best For | Cost | Speed |
|----------|----------|------|-------|
| **OpenAI** | High quality, batch processing | Moderate | Fast (instant) or 24h (batch) |
| **Anthropic** | Complex translations, large context | Higher | Fast |
| **DeepSeek** | Cost-effective translations | Low | Fast |

Switch providers via the `TRANSLATION_PROVIDER` environment variable.

## 🔌 API Reference

### Upload Endpoints

#### Upload Content Files

```http
POST /content/upload
Content-Type: multipart/form-data

senderId: owner-repo-abcdef0
sourceLocale: en
files: [file1.md, file2.md]
```

#### Upload Global Translations

```http
POST /global/upload
Content-Type: multipart/form-data

senderId: owner-repo-abcdef0
sourceLocale: en
file: en.json
```

#### Upload Page Translations

```http
POST /page/upload
Content-Type: multipart/form-data

senderId: owner-repo-abcdef0
sourceLocale: en
folderPath: account
file: en.json
```

#### Trigger Translation

```http
POST /content/translate
POST /global/translate
POST /page/translate
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "sourceLocale": "en",
  "targetLocales": ["fr", "de", "es"]
}
```

### Batch Translation (OpenAI Only)

OpenAI's Batch API provides **50% cost savings** with a 24-hour SLA, ideal for large translation jobs.

#### Create Batch

```http
POST /translate/batch
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "sourceLocale": "en",
  "targetLocales": ["fr", "de", "es"],
  "includeFiles": ["blog/post.md", "docs/guide.md"],
  "types": ["content", "global", "page"]  // or "all"
}
```

Response:

```json
{
  "batchId": "batch_en_1234567890_abc123",
  "requestCount": 150,
  "manifest": { ... }
}
```

#### Submit Batch to OpenAI

```http
POST /translate/batch/{batchId}/submit
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "metadata": {
    "job": "nightly-content"
  }
}
```

#### Check Batch Status

```http
GET /translate/batch/{batchId}/status?senderId=owner-repo-abcdef0
```

#### Process Batch Results

```http
POST /translate/batch/{batchId}/process
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0"
}
```

#### Retry Failed Requests

```http
POST /translate/batch/retry
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "originalBatchId": "batch_en_1234567890_abc123",
  "errorFileName": "batch_xxx_error.jsonl",
  "model": "gpt-4o-mini"  // optional, switch models
}
```

### Dashboard API

#### Get System Stats

```http
GET /api/stats
```

#### List Uploads

```http
GET /api/uploads?status=all&limit=50&offset=0
```

#### List Batches

```http
GET /api/batches?status=all&senderId=owner-repo-abcdef0
```

#### List Translations

```http
GET /api/translations?senderId=owner-repo-abcdef0
```

#### List Ready for GitHub

```http
GET /api/github/ready
```

### GitHub Integration

#### Create Pull Request

```http
POST /github/finalize
Content-Type: application/json

{
  "senderId": "owner-repo-abcdef0",
  "dryRun": false,
  "metadata": {
    "repository": {
      "owner": "username",
      "name": "repo",
      "baseBranch": "main",
      "baseCommitSha": "abc123..."
    },
    "sourceLocale": "en",
    "targetLocales": ["fr", "de"],
    "files": [
      {
        "type": "content",
        "sourceTempRelativePath": "blog/post.md",
        "repositorySourcePath": "content/en/blog/post.md"
      }
    ],
    "issue": {
      "title": "Add French and German translations"
    },
    "pullRequest": {
      "title": "feat: add fr & de translations",
      "baseBranch": "main"
    },
    "branch": {
      "prefix": "auto-i18n"
    }
  }
}
```

The workflow:

1. Creates a GitHub issue
2. Creates a feature branch from base commit
3. Commits source files seeded for each locale
4. Commits translated content
5. Opens a pull request

## 🧪 Testing

Auto-i18n has comprehensive test coverage for both backend and frontend.

### Backend Tests (Bun)

```bash
# Run all backend tests
bun run test:backend

# Watch mode
bun test --watch

# Specific test file
bun test tests/server/middleware/auth.test.ts
```

### Frontend Tests (Vitest)

```bash
# Run all frontend tests
bun run test:frontend

# Watch mode
bun run test:frontend:watch

# With coverage report
bun run test:frontend:coverage
```

### All Tests

```bash
bun run test:all
```

## 📁 Project Structure

```text
auto-i18n/
├── client/                # Vue 3 dashboard
│   ├── components/        # UI components
│   │   ├── ui/           # shadcn-vue components
│   │   ├── batches/      # Batch management
│   │   ├── translations/ # Translation views
│   │   ├── github/       # GitHub integration
│   │   └── uploads/      # Upload management
│   ├── composables/      # Vue composables
│   ├── lib/              # API client & utilities
│   └── types/            # TypeScript types
├── server/               # ElysiaJS backend
│   ├── config/           # Configuration
│   ├── middleware/       # Auth middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   │   ├── github/       # GitHub integration
│   │   └── translation/  # Translation services
│   └── utils/            # Utilities
├── tests/                # Test suites
│   ├── client/           # Frontend tests
│   └── server/           # Backend tests
└── tmp/                  # Temporary storage
    └── [senderId]/
        ├── uploads/      # Uploaded source files
        ├── batches/      # Batch job data
        ├── translations/ # Translation results
        └── metadata.json # Job metadata
```

## 🔒 Authentication

Auto-i18n supports optional authentication via access key:

1. Set `ACCESS_KEY` in your `.env` file
2. Dashboard prompts for access key on first visit
3. API requests include `X-Access-Key` header or `?access_key=` query parameter

If `ACCESS_KEY` is not set, authentication is disabled.

## 🌍 Supported Locales

Auto-i18n supports 40+ languages including: `ar`, `bg`, `cs`, `da`, `de`, `el`, `en`, `es`, `et`, `fi`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `lt`, `lv`, `nb`, `nl`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`, `th`, `tr`, `uk`, `vi`, `zh`, `zh-tw`, and more.

See `server/config/locales.ts` for the complete list.

## 🛠️ Development

### Tech Stack

**Backend:**

- [Bun](https://bun.sh) - Fast JavaScript runtime
- [ElysiaJS](https://elysiajs.com) - Fast web framework
- [Zod](https://zod.dev) - TypeScript-first schema validation
- [Winston](https://github.com/winstonjs/winston) - Logging

**Frontend:**

- [Vue 3](https://vuejs.org) - Progressive JavaScript framework
- [Vite](https://vitejs.dev) - Next generation frontend tooling
- [Tailwind CSS v4](https://tailwindcss.com) - Utility-first CSS
- [shadcn-vue](https://www.shadcn-vue.com) - Re-usable components
- [lucide-vue-next](https://lucide.dev) - Icon library

**AI Providers:**

- OpenAI SDK
- Anthropic SDK
- DeepSeek API

### Scripts

```bash
# Development
bun run dev              # Start API server with hot reload
bun run client           # Start Vue dashboard

# Build
bun run client:build     # Build Vue dashboard for production
bun run client:preview   # Preview production build

# Testing
bun run test             # Run all tests
bun run test:backend     # Run backend tests
bun run test:frontend    # Run frontend tests
bun run test:all         # Run both backend and frontend
bun run test:coverage    # Generate coverage reports
```

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

Built with [Bun](https://bun.sh), [ElysiaJS](https://elysiajs.com), and [Vue 3](https://vuejs.org).
