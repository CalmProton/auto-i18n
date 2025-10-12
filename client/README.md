# Vue Client Setup

## Quick Start

### 1. Start the API Server

In one terminal:

```bash
bun run dev
```

This starts the API server on `http://localhost:3001`

### 2. Start the Vue Client

In another terminal:

```bash
bun run client
```

This starts the Vue development server on `http://localhost:5173`

The Vue app is configured with a proxy to forward API requests to the backend server.

## Features

The Vue client provides interfaces for:

- **Content Upload**: Upload markdown content files with locale and folder information
- **Global Translation**: Upload global JSON translation files
- **Page Translation**: Upload page-specific JSON files
- **Batch Status**: Check the status of translation batches
- **GitHub Finalize**: Create pull requests with translated content

## Project Structure

```
client/
├── index.html              # Entry HTML file
├── src/
│   ├── main.ts            # Vue app initialization
│   ├── App.vue            # Main app component
│   ├── style.css          # Global styles
│   ├── vite-env.d.ts      # TypeScript declarations
│   └── components/
│       ├── ContentUpload.vue
│       ├── GlobalUpload.vue
│       ├── PageUpload.vue
│       ├── BatchStatus.vue
│       └── GitHubFinalize.vue
```

## Usage

1. Select a translation type (Content, Global, or Page)
2. Fill in the required fields:
   - **Sender ID**: A unique identifier for your project/session
   - **Source Locale**: The source language code (e.g., "en")
   - Additional fields depending on the type
3. Upload your files
4. Trigger the translation process
5. Check batch status to monitor progress
6. Finalize by creating a GitHub pull request

## Build for Production

To build the client for production:

```bash
bun run client:build
```

This creates an optimized build in the `client/dist` directory.

## Preview Production Build

```bash
bun run client:preview
```

## API Endpoints

The client communicates with these API endpoints:

- `POST /translate/content` - Upload content files
- `POST /translate/content/trigger` - Trigger content translation
- `POST /translate/global` - Upload global translation file
- `POST /translate/global/trigger` - Trigger global translation
- `POST /translate/page` - Upload page files
- `POST /translate/page/trigger` - Trigger page translation
- `GET /translate/batch/status` - Check batch status
- `POST /translate/batch/process` - Process batch results
- `POST /github/finalize` - Create GitHub pull request
