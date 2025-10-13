# Bug Fixes: Changes Workflow Issues

## Date
October 13, 2025

## Issues Fixed

### 1. File Type Misclassification in Dashboard UI
**Problem:** Page translation files (e.g., `pricing/en.json`) were being displayed as "Global Files" instead of "Page Files" in the dashboard UI.

**Root Cause:** The file type classification logic for change sessions only checked file extensions, not directory structure. All `.json` files were classified as global.

**Fix:** Updated `server/utils/dashboardUtils.ts` and `server/routes/dashboard.ts` to recursively scan directories and properly classify JSON files:
- JSON files at root level → `global`
- JSON files in subdirectories → `page`
- Markdown/MDX files → `content`

**Files Modified:**
- `server/utils/dashboardUtils.ts` (lines 140-170)
- `server/routes/dashboard.ts` (lines 6, 101-118)

---

### 2. Incorrect File Counts in Dashboard
**Problem:** Dashboard showed only 1 global file instead of 2 (missing the page file in the count).

**Root Cause:** Same as Issue #1 - file type misclassification caused page files to be miscounted.

**Fix:** Same fix as Issue #1. The recursive scanning with proper depth-based classification now correctly categorizes all files.

---

### 3. Batch Creation Missing Content Files
**Problem:** When creating a batch from changes, only 62 translation requests were created instead of 93. The markdown content file was not included - only the 2 JSON delta files were processed.

**Root Cause:** The `deltaBatchService.ts` only processed delta files (JSON changes). Content files (markdown) don't have deltas - they need to be translated in full, but were being ignored.

**Fix:** Enhanced the changes workflow to include content files:

1. **Updated `deltaBatchService.ts`:**
   - Added `contentFiles` parameter to `CreateDeltaBatchOptions`
   - Added logic to process content files alongside delta files
   - Added `readContentFile()` helper function
   - Added markdown-specific translation prompts:
     - `buildMarkdownSystemPrompt()` - instructs to preserve markdown syntax, frontmatter, code blocks, etc.
     - `buildMarkdownUserPrompt()` - wraps content for translation
   - Updated manifest creation to include both file types

2. **Updated `server/routes/changes.ts`:**
   - Added `findContentFiles()` function to recursively scan for `.md` and `.mdx` files
   - Scans `changes/original/` directory for content files
   - Passes both `deltaFiles` and `contentFiles` to `createDeltaBatch()`

**Files Modified:**
- `server/services/translation/deltaBatchService.ts` (lines 25-29, 40-157, 175-232)
- `server/routes/changes.ts` (lines 260-310)

**Expected Result:** 
- 2 JSON deltas × 31 target locales = 62 requests
- 1 markdown file × 31 target locales = 31 requests
- **Total: 93 translation requests** ✅

---

### 4. Status Polling Too Frequent
**Problem:** Frontend was checking batch status every 10 seconds, causing excessive API calls.

**Root Cause:** `PipelineTab.vue` had a hardcoded 10-second interval for the refresh, while the backend polling service correctly uses 30 seconds.

**Fix:** Updated `client/components/PipelineTab.vue` to use 30-second interval to match backend.

**Files Modified:**
- `client/components/PipelineTab.vue` (line 80)

**Change:**
```typescript
// Before
const { pause, resume } = useRefreshInterval(fetchUploads, { interval: 10000 })

// After
const { pause, resume } = useRefreshInterval(fetchUploads, { interval: 30000 })
```

---

## Testing Recommendations

1. **File Classification:**
   - Upload changes with mixed file types (global JSON at root, page JSON in subdirectories, markdown)
   - Verify dashboard shows correct counts for each type
   - Verify file details show correct categorization

2. **Batch Creation:**
   - Create a change session with 1 global JSON, 1 page JSON, and 1 markdown file
   - Process to create batch
   - Verify batch JSONL has requests for all 3 files
   - Expected: 3 files × number of target locales = total requests

3. **Polling Interval:**
   - Submit a batch
   - Monitor network tab to verify status checks occur every 30 seconds
   - Should not see requests more frequently than 30s

---

## Related Files

### Backend
- `server/utils/dashboardUtils.ts` - Dashboard data aggregation
- `server/routes/dashboard.ts` - Dashboard API endpoints
- `server/routes/changes.ts` - Changes workflow endpoints
- `server/services/translation/deltaBatchService.ts` - Batch creation from deltas and content
- `server/services/batchPollingService.ts` - Background polling (unchanged, was already correct)

### Frontend
- `client/components/PipelineTab.vue` - Pipeline status view
- `client/composables/usePipeline.ts` - Pipeline data management (unchanged)

---

## Technical Notes

### Content File Translation
Content files (markdown) are handled differently from JSON deltas:
- **JSON Deltas:** Only changed keys are translated (incremental)
- **Content Files:** Full file is translated (no delta extraction possible)

The batch service now creates two types of requests:
1. **JSON requests** with `response_format: { type: 'json_object' }`
2. **Markdown requests** without JSON formatting (plain text response)

### Manifest Structure
The batch manifest now includes:
- `types`: Array can include 'global', 'page', and 'content'
- `files`: Array includes entries for both delta and content files with appropriate `format` field ('json' or 'markdown')
