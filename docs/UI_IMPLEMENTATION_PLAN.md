# Auto-i18n Dashboard UI - Implementation Plan

## Overview
Transform the current upload-focused UI into a comprehensive dashboard for managing translation jobs, batches, and GitHub integration. The dashboard will provide full visibility into the translation pipeline from upload to PR creation.

---

## 📋 Current State Analysis

### Existing Data Structure
```
tmp/
  [senderId]/                    # e.g., calmproton-pxguru-965169e
    metadata.json                # Job metadata, target locales, repo info
    uploads/
      [locale]/                  # e.g., en
        content/
        global/
        page/
    batches/
      [batchId]/                 # e.g., batch_en_1760273488464_4655606d
        input.jsonl              # Batch input requests
        manifest.json            # Batch metadata (locales, types, stats)
        [openai_batch_id]_output.jsonl
        [openai_batch_id]_error.jsonl
    translations/
      [targetLocale]/            # e.g., fr, de, es
        content/
        global/
        page/
```

### Existing Metadata Structure
- `metadata.json` contains:
  - `senderId`: Unique identifier
  - `jobs[]`: Array of translation job definitions
  - `repository`: Owner, name, base branch, commit SHA
  - `sourceLocale`, `targetLocales`
  - `issue`, `pullRequest`, `branch` metadata
  - Timestamps: `createdAt`, `updatedAt`

- `manifest.json` (per batch) contains:
  - `batchId`, `senderId`
  - `types`: content/global/page
  - `sourceLocale`, `targetLocales`
  - `requestCount`, `totalCharacters`
  - `model`, `openAiFileId`, `openAiBatchId`
  - `submittedAt`, `status`, `completedAt`

---

## 🎯 UI Requirements Breakdown

### 1. **Uploads Tab** - Show Stored Uploads
**Display:**
- List all sender IDs in `tmp/` directory
- For each upload session:
  - Repository name (from metadata)
  - Sender ID (shortened/formatted)
  - Source locale
  - Target locales (count + list)
  - Upload timestamp
  - File counts by type (content/global/page)
  - Status indicator (files uploaded, translations pending/done)

**Actions:**
- View uploaded files (expandable list)
- Trigger translation (creates batch)
- Create batch (opens batch creation dialog)
- Delete upload session
- View metadata

### 2. **Batches Tab** - Batch Management
**Display:**
- List all batches across all sender IDs
- For each batch:
  - Batch ID (shortened)
  - Sender ID + repo name
  - Status: pending/processing/completed/failed/partially_failed
  - Progress (X/Y languages completed)
  - Source → Target locales
  - File types included
  - Request count
  - Created/submitted/completed timestamps
  - Error count (if any)

**Actions:**
- View batch details (manifest, requests)
- Download input/output JSONL
- Process output (if completed)
- Retry failed requests (creates new batch from error file)
- Cancel/delete batch
- Refresh status (poll OpenAI)

### 3. **Translations Tab** - Translation Results
**Display:**
- List all translation sessions with results
- For each session:
  - Repository + sender ID
  - Source locale
  - Translation matrix (locale × file type grid)
    - ✅ Complete
    - ⚠️ Partial
    - ❌ Missing/Failed
  - Completion percentage
  - Last updated timestamp

**Actions:**
- View translation files
- Download translations
- Compare source ↔ translated
- Mark as ready for PR
- Trigger missing translations

### 4. **GitHub Tab** - PR Creation & Management
**Display:**
- Translation sessions ready for GitHub
- For each session:
  - Repository details
  - Selected locales for PR
  - File count per locale
  - Translation status
  - Existing PR link (if created)

**Actions:**
- Select/deselect target locales
- Configure PR metadata (title, body, branch)
- Preview changes
- Create GitHub PR
- View created PR
- Sync status

---

## 🔧 New API Endpoints Required

### **A. Dashboard Overview Endpoints**

#### 1. `GET /api/dashboard/overview`
**Purpose:** Get system-wide statistics
**Response:**
```typescript
{
  totalUploads: number
  activeBatches: number
  completedBatches: number
  failedBatches: number
  totalTranslations: number
  pendingTranslations: number
  readyForPR: number
}
```

#### 2. `GET /api/uploads`
**Purpose:** List all upload sessions
**Query params:** `?status=all|pending|processing|completed`
**Response:**
```typescript
{
  uploads: [{
    senderId: string
    repository?: { owner: string, name: string }
    sourceLocale: string
    targetLocales: string[]
    fileCount: {
      content: number
      global: number
      page: number
      total: number
    }
    status: 'uploaded' | 'batched' | 'translating' | 'completed'
    createdAt: string
    updatedAt: string
    batchIds?: string[]  // Associated batches
    hasTranslations: boolean
    translationProgress?: {
      completed: number
      total: number
      percentage: number
    }
  }]
}
```

#### 3. `GET /api/uploads/:senderId`
**Purpose:** Get detailed upload information
**Response:**
```typescript
{
  senderId: string
  metadata: TranslationMetadataFile
  files: {
    content: FileInfo[]
    global: FileInfo[]
    page: FileInfo[]
  }
  batches: BatchSummary[]
  translations: {
    [locale: string]: {
      content: string[]
      global: string[]
      page: string[]
    }
  }
}
```

#### 4. `POST /api/uploads/:senderId/trigger`
**Purpose:** Trigger translation for uploaded files
**Body:**
```typescript
{
  types?: ('content' | 'global' | 'page')[] // Default: all
  targetLocales?: string[]  // Default: from metadata
  model?: string            // Default: from config
}
```
**Response:** Returns batch creation result

#### 5. `DELETE /api/uploads/:senderId`
**Purpose:** Delete upload session and all associated data
**Response:** `{ success: true, message: string }`

---

### **B. Batch Management Endpoints**

#### 6. `GET /api/batches`
**Purpose:** List all batches across all senders
**Query params:** 
- `?status=pending|processing|completed|failed|all`
- `?senderId=xxx` (filter by sender)
**Response:**
```typescript
{
  batches: [{
    batchId: string
    senderId: string
    repositoryName?: string
    status: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled'
    sourceLocale: string
    targetLocales: string[]
    types: ('content' | 'global' | 'page')[]
    requestCount: number
    errorCount?: number
    progress?: {
      completed: number
      failed: number
      total: number
      percentage: number
    }
    openAiBatchId?: string
    openAiStatus?: string
    model: string
    createdAt: string
    submittedAt?: string
    completedAt?: string
    hasOutput: boolean
    hasErrors: boolean
    outputProcessed: boolean
  }]
}
```

#### 7. `GET /api/batches/:batchId`
**Purpose:** Get detailed batch information
**Response:**
```typescript
{
  batchId: string
  senderId: string
  manifest: BatchManifest
  files: {
    input: { exists: boolean, path?: string, size?: number }
    output: { exists: boolean, path?: string, size?: number }
    error: { exists: boolean, path?: string, size?: number, errorCount?: number }
  }
  requests: BatchRequest[]  // Parsed from input.jsonl
  errors?: FailedRequest[]  // Parsed from error.jsonl if exists
  openAiStatus?: OpenAIBatchStatus
}
```

#### 8. `POST /api/batches/:batchId/refresh`
**Purpose:** Fetch latest status from OpenAI API
**Response:** Updated batch status

#### 9. `POST /api/batches/:batchId/process`
**Purpose:** Process completed batch output
**Response:**
```typescript
{
  success: boolean
  savedFiles: number
  failedFiles: number
  summary: {
    byLocale: Record<string, number>
    byType: Record<string, number>
  }
  errors?: ProcessingError[]
}
```

#### 10. `POST /api/batches/:batchId/retry`
**Purpose:** Create retry batch from failed requests
**Body:**
```typescript
{
  model?: string  // Optional: override model for retry
}
```
**Response:** New batch creation result with retry metadata

#### 11. `DELETE /api/batches/:batchId`
**Purpose:** Delete batch (local files only, not OpenAI)
**Response:** `{ success: true }`

---

### **C. Translation Management Endpoints**

#### 12. `GET /api/translations`
**Purpose:** List all translation sessions with results
**Query params:** `?senderId=xxx`
**Response:**
```typescript
{
  translations: [{
    senderId: string
    repositoryName?: string
    sourceLocale: string
    targetLocales: string[]
    matrix: {
      [locale: string]: {
        content: { total: number, exists: number, files: string[] }
        global: { total: number, exists: number, files: string[] }
        page: { total: number, exists: number, files: string[] }
      }
    }
    completionPercentage: number
    missingCount: number
    lastUpdated: string
  }]
}
```

#### 13. `GET /api/translations/:senderId/:locale/:type`
**Purpose:** Get translation files for specific locale and type
**Response:**
```typescript
{
  senderId: string
  locale: string
  type: 'content' | 'global' | 'page'
  files: [{
    name: string
    path: string
    size: number
    lastModified: string
  }]
}
```

#### 14. `GET /api/translations/:senderId/:locale/:type/:filename`
**Purpose:** Get specific translation file content
**Response:** File content (raw)

#### 15. `GET /api/translations/:senderId/status`
**Purpose:** Get detailed translation status matrix
**Response:**
```typescript
{
  senderId: string
  sourceLocale: string
  expectedFiles: {
    content: string[]
    global: string[]
    page: string[]
  }
  translations: {
    [locale: string]: {
      content: { [filename: string]: boolean }  // true if exists
      global: { [filename: string]: boolean }
      page: { [filename: string]: boolean }
    }
  }
  summary: {
    total: number
    completed: number
    missing: number
    percentage: number
  }
}
```

---

### **D. GitHub Integration Endpoints**

#### 16. `GET /api/github/ready`
**Purpose:** List upload sessions ready for GitHub PR
**Response:**
```typescript
{
  sessions: [{
    senderId: string
    repository?: { owner: string, name: string, baseBranch: string }
    sourceLocale: string
    availableLocales: string[]  // Locales with complete translations
    fileCount: number
    metadata: {
      issue?: IssueMetadata
      pullRequest?: PRMetadata
      branch?: BranchMetadata
    }
  }]
}
```

#### 17. `POST /api/github/finalize`
**Purpose:** Create GitHub issue + PR (enhanced version)
**Body:**
```typescript
{
  senderId: string
  targetLocales?: string[]  // Subset of available locales, default: all from metadata
  dryRun?: boolean
  metadata?: {
    repository?: RepositoryMetadata
    issue?: IssueMetadata
    pullRequest?: PRMetadata
    branch?: BranchMetadata
  }
}
```
**Response:**
```typescript
{
  success: boolean
  dryRun: boolean
  issue?: { number: number, url: string }
  pullRequest?: { number: number, url: string, branch: string }
  commits: {
    seed: string
    translations: string[]
  }
  filesProcessed: number
}
```

#### 18. `GET /api/github/status/:senderId`
**Purpose:** Check if PR exists for sender
**Response:**
```typescript
{
  hasPR: boolean
  pullRequest?: {
    number: number
    url: string
    state: 'open' | 'closed' | 'merged'
    createdAt: string
  }
  issue?: {
    number: number
    url: string
    state: 'open' | 'closed'
  }
}
```

---

### **E. Utility Endpoints**

#### 19. `GET /api/system/stats`
**Purpose:** System health and statistics
**Response:**
```typescript
{
  tmpDirectory: {
    size: number  // bytes
    uploadCount: number
    batchCount: number
    translationCount: number
  }
  providers: {
    openai: { configured: boolean, model: string }
    anthropic: { configured: boolean, model: string }
    deepseek: { configured: boolean, model: string }
  }
  github: {
    configured: boolean
    apiUrl: string
  }
}
```

#### 20. `GET /api/locales`
**Purpose:** Get supported locales
**Response:**
```typescript
{
  locales: string[]
  default: string
}
```

---

## 🎨 UI Component Structure

### **Navigation Layout**
```
┌─────────────────────────────────────────────────────┐
│ 🌍 Auto-i18n Dashboard        [Theme] [Settings]   │
├─────────────────────────────────────────────────────┤
│ [Uploads] [Batches] [Translations] [GitHub]         │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Tab Content Area                                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### **Component Hierarchy**

```
App.vue
├─ DashboardLayout.vue
│  ├─ DashboardHeader.vue
│  │  ├─ StatsOverview.vue (card with system stats)
│  │  └─ ThemeToggle.vue
│  │
│  ├─ DashboardTabs.vue
│  │  ├─ UploadsTab.vue
│  │  │  ├─ UploadsList.vue
│  │  │  │  └─ UploadCard.vue
│  │  │  │     ├─ UploadMetadata.vue
│  │  │  │     ├─ FilesList.vue
│  │  │  │     └─ UploadActions.vue
│  │  │  └─ CreateUploadButton.vue → triggers old upload forms
│  │  │
│  │  ├─ BatchesTab.vue
│  │  │  ├─ BatchesList.vue
│  │  │  │  └─ BatchCard.vue
│  │  │  │     ├─ BatchStatus.vue (progress, errors)
│  │  │  │     ├─ BatchDetails.vue
│  │  │  │     └─ BatchActions.vue (refresh, process, retry, delete)
│  │  │  └─ BatchFilters.vue (status, sender)
│  │  │
│  │  ├─ TranslationsTab.vue
│  │  │  ├─ TranslationsList.vue
│  │  │  │  └─ TranslationSessionCard.vue
│  │  │  │     ├─ TranslationMatrix.vue (locale × type grid)
│  │  │  │     ├─ CompletionProgress.vue
│  │  │  │     └─ TranslationActions.vue
│  │  │  └─ TranslationViewer.vue (modal/drawer for file preview)
│  │  │
│  │  └─ GitHubTab.vue
│  │     ├─ ReadySessions.vue
│  │     │  └─ GitHubSessionCard.vue
│  │     │     ├─ LocaleSelector.vue (checkbox list)
│  │     │     ├─ PRMetadataForm.vue
│  │     │     └─ CreatePRButton.vue
│  │     └─ ExistingPRsList.vue
│  │
│  └─ NotificationToasts.vue (for success/error messages)
│
└─ Dialogs/
   ├─ CreateBatchDialog.vue
   ├─ ViewBatchDetailsDialog.vue
   ├─ RetryBatchDialog.vue
   ├─ ViewFilesDialog.vue
   ├─ ConfirmDeleteDialog.vue
   └─ PRPreviewDialog.vue
```

---

## 📊 Data Flow & State Management

### **State Management Approach**
Use Vue 3 Composition API with composables:

```typescript
// composables/useUploads.ts
export function useUploads() {
  const uploads = ref<Upload[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  const fetchUploads = async () => { /* ... */ }
  const refreshUpload = async (senderId: string) => { /* ... */ }
  const deleteUpload = async (senderId: string) => { /* ... */ }
  const triggerTranslation = async (senderId: string, options) => { /* ... */ }
  
  return {
    uploads,
    loading,
    error,
    fetchUploads,
    refreshUpload,
    deleteUpload,
    triggerTranslation
  }
}

// composables/useBatches.ts
export function useBatches() { /* ... */ }

// composables/useTranslations.ts
export function useTranslations() { /* ... */ }

// composables/useGitHub.ts
export function useGitHub() { /* ... */ }
```

### **Polling Strategy**
- Auto-refresh batch status every 30s when batches are processing
- Manual refresh button always available
- WebSocket support for real-time updates (future enhancement)

---

## 🔄 Implementation Phases

### **Phase 1: Backend API Development** (Estimated: 1-2 days)
1. Create new route file: `src/routes/api.ts`
2. Implement utility functions:
   - `listAllSenderIds()` - scan tmp directory
   - `getUploadStats()` - count files per type
   - `getBatchStatus()` - check batch files and OpenAI status
   - `getTranslationMatrix()` - scan translations directory
3. Implement endpoints A1-A5 (Uploads)
4. Implement endpoints B6-B11 (Batches)
5. Implement endpoints C12-C15 (Translations)
6. Implement endpoints D16-D18 (GitHub)
7. Implement endpoints E19-E20 (Utility)
8. Add comprehensive error handling
9. Add request validation (Zod schemas)
10. Write API documentation

### **Phase 2: Frontend Composables** (Estimated: 1 day)
1. Create composables for each domain:
   - `useUploads.ts`
   - `useBatches.ts`
   - `useTranslations.ts`
   - `useGitHub.ts`
   - `useToast.ts` (notifications)
2. Implement API client functions
3. Add loading states and error handling
4. Add optimistic updates where appropriate

### **Phase 3: UI Components - Core** (Estimated: 2-3 days)
1. Create `DashboardLayout.vue` with tabs
2. Create `StatsOverview.vue` component
3. Build **Uploads Tab**:
   - `UploadsList.vue` with cards
   - `UploadCard.vue` with metadata display
   - Action buttons (trigger, create batch, delete)
   - File list expansion
4. Build **Batches Tab**:
   - `BatchesList.vue` with filtering
   - `BatchCard.vue` with status indicators
   - Progress bars and error counts
   - Action buttons (refresh, process, retry, delete)

### **Phase 4: UI Components - Advanced** (Estimated: 2-3 days)
1. Build **Translations Tab**:
   - `TranslationSessionCard.vue`
   - `TranslationMatrix.vue` (grid visualization)
   - Completion progress indicators
   - File preview functionality
2. Build **GitHub Tab**:
   - `GitHubSessionCard.vue`
   - Locale selection checkboxes
   - PR metadata form
   - PR creation flow
3. Add dialogs/modals:
   - Batch creation dialog
   - Batch details dialog
   - Retry confirmation
   - Delete confirmation
   - PR preview

### **Phase 5: Polish & Testing** (Estimated: 1-2 days)
1. Add loading skeletons
2. Add empty states
3. Improve error messages
4. Add tooltips and help text
5. Responsive design adjustments
6. Add keyboard shortcuts
7. Test all flows end-to-end
8. Performance optimization (virtualization for long lists)

### **Phase 6: Documentation** (Estimated: 0.5 day)
1. Update README with new UI features
2. Add API endpoint documentation
3. Create user guide
4. Add inline code comments

---

## 🎯 Success Criteria

### **Functional Requirements**
- ✅ All uploaded sessions are visible with metadata
- ✅ All batches are visible with real-time status
- ✅ Translation completion is visualized clearly
- ✅ GitHub PR creation is streamlined
- ✅ Failed batches can be retried from UI
- ✅ All actions have proper feedback (loading, success, error)

### **Non-Functional Requirements**
- ⚡ Initial page load < 2 seconds
- 📱 Responsive design (mobile-friendly)
- ♿ Accessible (WCAG 2.1 AA)
- 🎨 Consistent with shadcn-vue design system
- 🔐 Proper error handling throughout
- 📊 Efficient data fetching (pagination, caching)

### **User Experience**
- Intuitive navigation
- Clear status indicators
- Helpful error messages
- Undo/confirmation for destructive actions
- Keyboard navigation support
- Smooth animations and transitions

---

## 🚨 Edge Cases & Considerations

1. **Large Data Sets**
   - Implement pagination for lists (10-20 items per page)
   - Virtualize long lists (e.g., 100+ batches)
   - Lazy load file contents

2. **Concurrent Operations**
   - Handle multiple batches running simultaneously
   - Prevent duplicate batch creation
   - Show warnings for conflicting operations

3. **Missing/Corrupted Data**
   - Gracefully handle missing metadata files
   - Show warnings for incomplete uploads
   - Provide "repair" options where possible

4. **OpenAI API Failures**
   - Display API errors clearly
   - Provide retry mechanisms
   - Show rate limit warnings

5. **GitHub API Failures**
   - Handle authentication errors
   - Show permission issues
   - Provide manual fallback options

6. **Directory Cleanup**
   - Add "cleanup old data" utility
   - Warn before deleting data
   - Allow export before deletion

---

## 📝 TypeScript Types to Add

```typescript
// types/api.ts

export interface Upload {
  senderId: string
  repository?: { owner: string, name: string }
  sourceLocale: string
  targetLocales: string[]
  fileCount: {
    content: number
    global: number
    page: number
    total: number
  }
  status: 'uploaded' | 'batched' | 'translating' | 'completed'
  createdAt: string
  updatedAt: string
  batchIds?: string[]
  hasTranslations: boolean
  translationProgress?: {
    completed: number
    total: number
    percentage: number
  }
}

export interface Batch {
  batchId: string
  senderId: string
  repositoryName?: string
  status: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled'
  sourceLocale: string
  targetLocales: string[]
  types: ('content' | 'global' | 'page')[]
  requestCount: number
  errorCount?: number
  progress?: {
    completed: number
    failed: number
    total: number
    percentage: number
  }
  openAiBatchId?: string
  openAiStatus?: string
  model: string
  createdAt: string
  submittedAt?: string
  completedAt?: string
  hasOutput: boolean
  hasErrors: boolean
  outputProcessed: boolean
}

export interface TranslationSession {
  senderId: string
  repositoryName?: string
  sourceLocale: string
  targetLocales: string[]
  matrix: {
    [locale: string]: {
      content: { total: number, exists: number, files: string[] }
      global: { total: number, exists: number, files: string[] }
      page: { total: number, exists: number, files: string[] }
    }
  }
  completionPercentage: number
  missingCount: number
  lastUpdated: string
}

export interface GitHubSession {
  senderId: string
  repository?: { owner: string, name: string, baseBranch: string }
  sourceLocale: string
  availableLocales: string[]
  fileCount: number
  metadata: {
    issue?: IssueMetadata
    pullRequest?: PRMetadata
    branch?: BranchMetadata
  }
}
```

---

## 🎨 UI Wireframes (ASCII)

### Uploads Tab
```
┌──────────────────────────────────────────────────────────┐
│ 📊 Overview: 5 Uploads • 12 Batches • 87% Translated    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 📦 calmproton-pxguru-965169e                     [Delete]│
│ Repository: CalmProton/pxguru                            │
│ en → ar, bg, cs, de, el, es... (+20 more)               │
│ ─────────────────────────────────────────────────────────│
│ 📄 Files: 45 content • 1 global • 3 page                │
│ 📈 Progress: ████████████████░░░░ 75% (21/28 locales)   │
│ ─────────────────────────────────────────────────────────│
│ [View Files] [Create Batch] [Trigger Translation]       │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 📦 myproject-abc123                              [Delete]│
│ Repository: User/myproject                               │
│ en → fr, de                                              │
│ ─────────────────────────────────────────────────────────│
│ 📄 Files: 10 content • 1 global • 0 page                │
│ ✅ Complete: All translations ready                      │
│ ─────────────────────────────────────────────────────────│
│ [View Files] [Create PR]                                 │
└──────────────────────────────────────────────────────────┘
```

### Batches Tab
```
┌──────────────────────────────────────────────────────────┐
│ Filters: [All Status ▼] [All Senders ▼]    [Refresh All]│
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 🔄 batch_en_1760273488464_4655606d          Status: ●● │
│ calmproton-pxguru-965169e • pxguru                       │
│ ─────────────────────────────────────────────────────────│
│ Progress: ████████████████████ 100% (1240/1240)         │
│ Errors: 15 failed requests                               │
│ Model: gpt-4-mini • Submitted 2 hours ago               │
│ ─────────────────────────────────────────────────────────│
│ [Refresh] [Process Output] [Retry Failed] [View Details]│
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ ⏳ batch_en_1760269403519_fa8a129e          Status: ⏸  │
│ calmproton-pxguru-965169e • pxguru                       │
│ ─────────────────────────────────────────────────────────│
│ Progress: ██████░░░░░░░░░░░░░░ 35% (420/1200)           │
│ Model: gpt-4-mini • Submitted 5 hours ago               │
│ ─────────────────────────────────────────────────────────│
│ [Refresh] [View Details] [Cancel]                        │
└──────────────────────────────────────────────────────────┘
```

### Translations Tab
```
┌──────────────────────────────────────────────────────────┐
│ 🌐 calmproton-pxguru-965169e                    [Export] │
│ Repository: CalmProton/pxguru                            │
│ Source: en → 28 target locales                          │
│ ─────────────────────────────────────────────────────────│
│ Translation Matrix:                                      │
│                Content  Global  Page                     │
│   ar   [ ✅ 45 ][ ✅ 1 ][ ✅ 3 ]  100%                   │
│   bg   [ ✅ 45 ][ ✅ 1 ][ ✅ 3 ]  100%                   │
│   cs   [ ⚠️ 43 ][ ✅ 1 ][ ✅ 3 ]   96%                   │
│   de   [ ✅ 45 ][ ✅ 1 ][ ✅ 3 ]  100%                   │
│   ... (+24 more)                                         │
│ ─────────────────────────────────────────────────────────│
│ Overall: 96% complete • 51 files missing                │
│ [View Missing] [Trigger Missing] [Ready for PR]         │
└──────────────────────────────────────────────────────────┘
```

### GitHub Tab
```
┌──────────────────────────────────────────────────────────┐
│ 🔀 calmproton-pxguru-965169e                             │
│ Repository: CalmProton/pxguru (main branch)             │
│ ─────────────────────────────────────────────────────────│
│ Select Locales for PR:                                   │
│ ☑ ar (49 files) ☑ bg (49 files) ☑ cs (47 files)        │
│ ☑ de (49 files) ☑ el (49 files) ☑ es (49 files)        │
│ ... [Select All] [Deselect All]                         │
│ ─────────────────────────────────────────────────────────│
│ PR Configuration:                                        │
│ Title: [Add translations for ar, bg, cs, de, el, es...] │
│ Branch: [auto-i18n-20250112-1234                      ] │
│ ─────────────────────────────────────────────────────────│
│ [Preview Changes] [Create Pull Request]                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ ✅ Pull Request Created!                                 │
│ PR #42: Add translations for 6 languages                │
│ Branch: auto-i18n-20250112-1234                         │
│ [View PR on GitHub →]                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Considerations

1. **Input Validation**
   - Sanitize sender IDs (no path traversal)
   - Validate locale codes
   - Limit file sizes for downloads

2. **Rate Limiting**
   - Limit API calls per minute
   - Prevent batch spam

3. **Authentication** (future)
   - Add API key validation
   - User session management
   - Role-based access control

---

## 📈 Future Enhancements

1. **Real-time Updates**
   - WebSocket support for batch status
   - Live progress updates

2. **Batch Scheduling**
   - Schedule translations for off-peak hours
   - Automatic retry on failure

3. **Cost Tracking**
   - Track OpenAI token usage
   - Display cost estimates

4. **Advanced Filtering**
   - Search by repo name
   - Filter by date range
   - Sort by various criteria

5. **Diff Viewer**
   - Compare source vs. translated
   - Highlight changes
   - Side-by-side view

6. **Notifications**
   - Email on batch completion
   - Webhook integration
   - Browser notifications

---

## ✅ Implementation Checklist

### Backend
- [ ] Create `src/routes/api.ts`
- [ ] Implement utility functions for directory scanning
- [ ] Add endpoints A1-A5 (Uploads)
- [ ] Add endpoints B6-B11 (Batches)
- [ ] Add endpoints C12-C15 (Translations)
- [ ] Add endpoints D16-D18 (GitHub)
- [ ] Add endpoints E19-E20 (Utility)
- [ ] Add request validation schemas
- [ ] Add error handling middleware
- [ ] Write API tests

### Frontend
- [ ] Create composables (useUploads, useBatches, etc.)
- [ ] Build DashboardLayout
- [ ] Build Uploads Tab
- [ ] Build Batches Tab
- [ ] Build Translations Tab
- [ ] Build GitHub Tab
- [ ] Add dialogs/modals
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add empty states
- [ ] Responsive design
- [ ] Accessibility improvements

### Documentation
- [ ] Update README
- [ ] API documentation
- [ ] User guide
- [ ] Code comments

---

## 📞 Questions for Clarification

1. **Pagination**: Should we paginate uploads/batches lists? If yes, what's the preferred page size?
2. **Auto-refresh**: Should batch status auto-refresh, and if so, at what interval?
3. **File Preview**: Should we support previewing markdown/JSON content in the UI?
4. **Locale Selection**: In GitHub tab, should there be a "smart" default that only selects completed locales?
5. **Delete Behavior**: Should deleting an upload also delete associated batches and translations?
6. **Export**: Should we support exporting translations as ZIP files?
7. **Undo**: Should destructive actions (delete) be undoable?
8. **Permissions**: Will this UI ever need multi-user support / authentication?

---

**Total Estimated Time: 7-11 days**

This plan provides a comprehensive roadmap for transforming the current upload-focused UI into a full-featured translation management dashboard. The phased approach allows for iterative development and testing, ensuring each component works correctly before moving to the next.
