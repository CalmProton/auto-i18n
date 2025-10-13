# Dashboard Pipeline Refactor - Implementation Summary

**Date**: October 13, 2025  
**Status**: ✅ Complete

## Overview

Successfully refactored the dashboard to unify "full uploads" and "change sessions" into a single pipeline view. Both workflow types now follow the same 7-step pipeline process and are displayed together in a unified interface.

## Goals Achieved

1. ✅ Unified two separate upload workflows into one pipeline system
2. ✅ Renamed "Changes" tab to "Pipeline" and made it the primary tab (1st position)
3. ✅ Added session type filtering throughout the dashboard
4. ✅ Updated tab order: Pipeline → Uploads → Batches → Translations → Git
5. ✅ Renamed "GitHub" tab to "Git" with comprehensive session overview

## Architecture Changes

### Backend Changes

#### 1. Type System Updates (`server/types/api.ts`)

**Enhanced Upload Interface:**
```typescript
export interface Upload {
  senderId: string
  sessionType: SessionType  // NEW: 'full-upload' | 'change-session'
  pipelineStatus?: PipelineStatus  // NEW: Current step in pipeline
  steps?: PipelineSteps  // NEW: Detailed step status
  commit?: CommitInfo  // NEW: Git commit information
  changeCount?: ChangeCount  // NEW: Files changed stats
  automationMode?: AutomationMode  // NEW: 'auto' | 'manual'
  hasErrors?: boolean  // NEW: Error flag
  errorCount?: number  // NEW: Error count
  // ... existing fields
}
```

**New Supporting Types:**
- `SessionType`: Distinguishes between full-upload and change-session
- `PipelineStatus`: 7-step pipeline stages (uploaded → batch-created → submitted → processing → completed → pr-created)
- `PipelineSteps`: Detailed status for each step with timestamps and metadata
- `TranslationType`: 'full' | 'delta' to distinguish translation types

#### 2. Dashboard Utilities (`server/utils/dashboardUtils.ts`)

**Updated Functions:**

- **`getUploadInfo(senderId)`**: 
  - Now checks both `metadata.json` (full uploads) and `changes/metadata.json` (change sessions)
  - Merges change session data into Upload format
  - Builds PipelineSteps from ChangeSessionMetadata
  - Calculates translation progress from both `translations/` and `deltas/` directories

- **`getTranslationStatus(senderId)`**:
  - Determines translationType based on directory structure
  - Checks both `translations/` (full) and `deltas/` (change) paths
  - Adds `translationPath` field to indicate storage location

- **`isReadyForGitHub(senderId)`**:
  - Handles both session types
  - Extracts PR info from change session metadata
  - Calculates translationProgress with completed/total/files stats

### Frontend Changes

#### 1. Type System (`client/types/api.ts`)

- Synchronized all backend types to frontend
- Removed duplicate definitions (CommitInfo, StepStatus, AutomationMode)
- Made `ChangeStatus` an alias to `PipelineStatus` for backward compatibility
- Extended `ChangeSessionSteps` from `PipelineSteps`

#### 2. Composables

**New: `usePipeline` (replaced `useChanges`)**

```typescript
interface PipelineFilters {
  search: string
  status: PipelineStatus | 'all'
  sessionType: SessionType | 'all'  // NEW
}

export function usePipeline() {
  // State
  const uploads = ref<Upload[]>([])  // Renamed from 'changes'
  const selectedUpload = ref<Upload | null>(null)
  
  // Methods (all renamed and updated)
  - fetchUploads() - Calls /api/uploads
  - fetchUpload(senderId)
  - processSession(senderId) - Routes to correct endpoint by sessionType
  - finalizeSession(senderId) - Creates PR via correct endpoint
  - deleteSession(senderId)
  - retryBatchOutput(senderId)
  - retryPR(senderId)
  - resetSession(senderId, full)
  
  // Computed
  - filteredUploads - Filters by sessionType AND status
  - stats - Includes bySessionType breakdown
}
```

#### 3. Components

**PipelineTab.vue** (renamed from ChangesTab.vue)

Features:
- Uses `usePipeline` composable
- Adapter pattern to convert `Upload` → `ChangeSession` for existing card component
- Stats grid shows: Total Sessions, Full Uploads, Changes, Processing, Automated, With Errors
- Filters: Search, Session Type (All/Full Uploads/Changes), Status (8 pipeline stages)
- Icon changed from GitBranch to Workflow
- Title: "Translation Pipeline"

**TranslationsTab.vue**

Features:
- Added two dropdown filters:
  - **Session Type**: All Sessions / Full Uploads / Changes
  - **Translation Type**: All Types / Full Translations / Deltas
- Shows count: "Showing X of Y sessions"
- Dynamic empty state based on filter state
- Displays both full translations (`translations/`) and delta translations (`deltas/`)

**GitTab.vue** (renamed from GitHubTab.vue)

Features:
- Title changed to "Git Integration"
- Stats grid: Total Sessions, Ready for PR, With PR, Total Translations
- Shows ALL translation sessions (not just ready ones)
- Icon changed from Github to GitBranch
- totalTranslations computed from translationProgress data

**DashboardLayout.vue**

Changes:
- New tab order: Pipeline (1st), Uploads (2nd), Batches (3rd), Translations (4th), Git (5th)
- Default tab changed to 'pipeline'
- Updated keyboard shortcuts: Alt+1 through Alt+5 for new order
- Updated imports: PipelineTab, GitTab (instead of ChangesTab, GitHubTab)
- Updated validTabs array: ['pipeline', 'uploads', 'batches', 'translations', 'git']

## Data Flow

### Upload Session Lifecycle

```
1. File Upload (via workflow or manual)
   ↓
2. Stored in tmp/{senderId}/uploads/ OR tmp/{senderId}/changes/
   ↓
3. Metadata saved with sessionType
   ↓
4. Dashboard fetches via /api/uploads (unified endpoint)
   ↓
5. Backend merges both session types into Upload format
   ↓
6. Frontend displays in PipelineTab with sessionType badge
   ↓
7. User processes through 7-step pipeline
   ↓
8. Translations saved to translations/ or deltas/ based on type
   ↓
9. TranslationsTab shows with translationType filter
   ↓
10. GitTab shows session ready for PR
```

### Storage Paths

**Full Upload:**
- Uploads: `tmp/{senderId}/uploads/{locale}/{type}/`
- Metadata: `tmp/{senderId}/metadata.json`
- Translations: `tmp/{senderId}/translations/{locale}/{type}/`

**Change Session:**
- Original: `tmp/{senderId}/changes/original/`
- Metadata: `tmp/{senderId}/changes/metadata.json`
- Deltas: `tmp/{senderId}/deltas/{locale}/{type}/`

## Pipeline Steps

All sessions follow these 7 steps:

1. **uploaded** - Files received and stored
2. **batchCreated** - Batch JSONL file created
3. **submitted** - Batch submitted to OpenAI
4. **processing** - OpenAI processing batch
5. **outputReceived** - Output file downloaded
6. **translationsProcessed** - Translations extracted and saved
7. **prCreated** - Pull request created

Each step tracks:
- `completed`: boolean
- `timestamp`: ISO string (when completed)
- `error`: string (if failed)
- Step-specific metadata (batchId, openAiBatchId, progress, translationCount, pullRequestNumber, pullRequestUrl)

## API Endpoints

### Unified Endpoints
- `GET /api/uploads` - Returns both session types with merged format
- `GET /api/uploads/:senderId` - Details for specific session
- `GET /api/translations` - Returns both full and delta translations
- `GET /api/github/ready` - Returns all sessions with translation progress

### Session-Type-Specific Processing
- `POST /translate/batch` - Full upload batch creation
- `POST /translate/changes/:id/*` - Change session processing
- Both types use same `POST /github/finalize` for PR creation

## Testing Checklist

### Manual Testing Required

- [ ] Upload full translation files
  - Verify appears in Pipeline tab with "Full Uploads" badge
  - Verify stats show correct count
  - Process through all 7 steps
  - Check translations appear in TranslationsTab with "Full" type
  - Verify appears in GitTab with progress

- [ ] Trigger change workflow
  - Verify appears in Pipeline tab with "Changes" badge
  - Verify stats show correct count
  - Process through pipeline
  - Check deltas appear in TranslationsTab with "Delta" type
  - Verify appears in GitTab

- [ ] Test Filters
  - PipelineTab: Filter by session type (All/Full/Changes)
  - PipelineTab: Filter by status (8 stages)
  - TranslationsTab: Filter by session type
  - TranslationsTab: Filter by translation type

- [ ] Test Navigation
  - Keyboard shortcuts: Alt+1 through Alt+5
  - Tab persistence in URL (?tab=pipeline)
  - Browser back/forward buttons
  - Direct links to specific tabs

- [ ] Error Handling
  - Sessions with errors show error count
  - Retry buttons work correctly
  - Reset session functionality

## Files Modified

### Backend
- `server/types/api.ts` - Type definitions
- `server/utils/dashboardUtils.ts` - Data aggregation logic

### Frontend - Types
- `client/types/api.ts` - Frontend type definitions

### Frontend - Composables
- `client/composables/usePipeline.ts` - NEW (replaced useChanges)
- `client/composables/index.ts` - Updated exports

### Frontend - Components
- `client/components/PipelineTab.vue` - NEW (renamed from ChangesTab)
- `client/components/TranslationsTab.vue` - Added filters
- `client/components/GitTab.vue` - NEW (renamed from GitHubTab)
- `client/components/DashboardLayout.vue` - Updated tab order and imports

## Breaking Changes

### For Users
- URL parameter changed: `?tab=changes` → `?tab=pipeline`
- Keyboard shortcut changed: Alt+3 was Changes, now Alt+1 is Pipeline
- GitHub tab moved from position 5 to position 5 (but renamed to "Git")

### For Developers
- Import changed: `useChanges` → `usePipeline`
- Component names: `ChangesTab` → `PipelineTab`, `GitHubTab` → `GitTab`
- Type: `ChangeStatus` now alias to `PipelineStatus` (deprecated)
- API: Change sessions now returned via `/api/uploads` endpoint

## Backward Compatibility

- `ChangeStatus` type aliased to `PipelineStatus` (deprecated but functional)
- `ChangeSessionSteps` extends `PipelineSteps` (compatible)
- Old change session data structures still supported by backend utilities
- Adapter pattern in PipelineTab converts Upload to ChangeSession format for existing card component

## Next Steps

1. Monitor for any edge cases in production
2. Consider creating dedicated "PipelineSessionCard" component to replace adapter pattern
3. Add session type badges to card displays
4. Consider adding automation mode filtering
5. Add export functionality for pipeline metrics

## Performance Considerations

- Dashboard loads all sessions at once (consider pagination for 100+ sessions)
- Stats calculated client-side in computed properties
- Auto-refresh every 10 seconds (can be adjusted)
- Adapter function runs on every render (minimal impact, but could be optimized)

## Security

- No changes to authentication or authorization
- Session data still protected by existing access controls
- No new API endpoints exposed publicly

## Documentation

- Updated `.github/copilot-instructions.md` with new architecture
- This implementation summary serves as reference
- Component JSDoc comments maintained
