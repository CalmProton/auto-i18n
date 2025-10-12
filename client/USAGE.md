# Using the Vue Client

## Overview

The Vue client provides a simple web interface to interact with the auto-i18n API. It's perfect for manual uploads, testing, and small translation jobs.

## Getting Started

1. **Start both servers:**

   In one terminal:
   ```bash
   bun run dev
   ```

   In another terminal:
   ```bash
   bun run client
   ```

2. **Open your browser:**
   
   Navigate to `http://localhost:5173`

## Workflow Example

### Translating Content Files

1. **Select "Content Files"** from the translation type options
2. **Fill in the form:**
   - Sender ID: `my-project-123` (any unique identifier)
   - Source Locale: `en`
   - Folder Name: `blog` (where your markdown files are stored)
3. **Select files:** Choose one or more `.md` files from your computer
4. **Click "Upload Content"**
5. **Trigger translation:** Once upload succeeds, click "Start Translation"

The system will:
- Save your files to `tmp/my-project-123/uploads/en/content/blog/`
- Create translation requests for all supported target locales
- Generate translations in `tmp/my-project-123/translations/<locale>/content/blog/`

### Translating Global JSON

1. **Select "Global Translation"**
2. **Fill in:**
   - Sender ID: `my-project-123`
   - Source Locale: `en`
3. **Select your global JSON file** (e.g., `en.json`)
4. **Upload and trigger**

### Checking Batch Status

If you're using OpenAI's batch API:

1. **Scroll to "Batch Status & Processing"**
2. **Enter your Sender ID**
3. **Click "Check Batch Status"**
4. When the batch is complete, click **"Process Batch Results"**

### Creating a GitHub Pull Request

1. **Scroll to "GitHub Finalize"**
2. **Fill in:**
   - Sender ID: `my-project-123`
   - Repository Owner: `CalmProton`
   - Repository Name: `my-repo`
   - Base Branch: `main` (optional, defaults to main)
3. **Click "Create Pull Request"**

The system will:
- Create a GitHub issue summarizing the translation
- Create a new branch with your translations
- Open a pull request for review

## Tips

- **Sender ID:** Use a consistent format like `<owner>-<repo>-<commit-sha>` to keep track of different translation jobs
- **Multiple uploads:** You can upload content, global, and page files with the same sender ID - they'll all be included in the final PR
- **Check logs:** The API logs are available in `tmp/logs/` for troubleshooting
- **Metadata persistence:** After the first upload, some metadata is saved and will be reused for subsequent operations with the same sender ID

## Architecture

The Vue client uses:
- **Vite** for fast development and build
- **Vue 3** with Composition API
- **TypeScript** for type safety
- **Vite proxy** to forward API requests to the backend (no CORS issues in development)

API requests are proxied through Vite's dev server:
- Client makes request to `/translate/content`
- Vite forwards to `http://localhost:3000/translate/content`
- Response returns through the proxy

## Development

The client is a standard Vue + Vite project. You can:

- **Modify components** in `client/src/components/`
- **Update styles** in `client/src/style.css`
- **Add new features** by creating new components and importing them in `App.vue`

Hot module replacement (HMR) is enabled, so changes appear instantly in your browser.

## Production Build

To build the client for production:

```bash
bun run client:build
```

This creates optimized static files in `client/dist/`. You can serve these with any static file server or integrate them with your backend.
