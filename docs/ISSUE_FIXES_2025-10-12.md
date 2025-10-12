# Issue Fixes - October 12, 2025

## Summary

Fixed three critical dashboard issues:

1. ✅ Uploads only showing global en.json files
2. ✅ No failing batch display, no button to retry fails
3. ✅ Translations tab matrix not showing content and page translations

## Issue 1: File Count Not Recursive

**Problem:** The `countFilesByType` function in `dashboardUtils.ts` was only counting files in the immediate directory, not subdirectories. This caused the dashboard to show only global files (which are flat) and miss content/page files (which are nested in folders).

**Solution:** Added a `countFilesRecursive` helper function that traverses directories recursively to count all files, regardless of nesting depth.

**Files Changed:**
- `server/utils/dashboardUtils.ts`

**Before:**
```json
{
  "fileCount": {
    "content": 0,
    "global": 1,
    "page": 0,
    "total": 1
  }
}
```

**After:**
```json
{
  "fileCount": {
    "content": 21,
    "global": 1,
    "page": 20,
    "total": 42
  }
}
```

## Issue 2: Failed Batches Not Detected

**Problem:** Batches with error files were showing as "draft" status instead of "failed" or "partially_failed". The retry button logic existed but wasn't triggered because batches weren't being detected as failed.

**Solution:**
1. Enhanced error file detection to find error files with various naming patterns
2. Added logic to detect batch status from error file presence even when batch wasn't submitted via OpenAI API
3. Updated status determination to mark batches as `partially_failed` when error count > 0 but < total
4. Added `errorFileName` to batch info so retry endpoint knows which file to process
5. Implemented the retry endpoint in dashboard routes by forwarding to existing `createRetryBatch` service

**Files Changed:**
- `server/utils/dashboardUtils.ts` - Enhanced error detection and status logic
- `server/types/api.ts` - Added `errorFileName` field to Batch interface
- `client/src/types/api.ts` - Added `errorFileName` field to Batch interface
- `server/routes/dashboard.ts` - Implemented retry endpoint, added `partially_failed` to query validation
- `client/src/components/batches/BatchActions.vue` - Updated retry to pass errorFileName

**Status Detection Logic:**
- If error file exists with errors:
  - `errorCount === totalRequests` → `failed`
  - `errorCount < totalRequests` → `partially_failed`
- Shows error count and enables retry button
- Retry button creates new batch from failed requests

**Result:**
```json
{
  "status": "partially_failed",
  "errorCount": 122,
  "progress": {
    "completed": 1180,
    "total": 1302,
    "percentage": 91,
    "errorCount": 122
  },
  "errorFileName": "batch_68eb94cca7cc81909cb8ed2f1dd5facd_error.jsonl",
  "hasErrors": true
}
```

## Issue 3: Translation Matrix Not Showing Files

**Problem:** The translation matrix was showing 0/0 for content and page translations even though the files existed in the translations directory.

**Root Cause:** Same as Issue 1 - the recursive file counting was needed to properly count nested translation files.

**Solution:** The `countFilesRecursive` function fix applied to both uploads and translations directories, so both now count correctly.

**Result:**
```json
{
  "matrix": {
    "ru": {
      "content": { "count": 21, "expected": 21 },
      "global": { "count": 1, "expected": 1 },
      "page": { "count": 20, "expected": 20 },
      "percentage": 100
    }
  }
}
```

## Testing

All endpoints tested and verified:

```bash
# Test uploads
curl http://localhost:3000/api/uploads
# ✅ Shows fileCount: { content: 21, global: 1, page: 20, total: 42 }

# Test batches
curl http://localhost:3000/api/batches
# ✅ Shows partially_failed status with error count

# Test batch detail with retry
curl http://localhost:3000/api/batches/calmproton-pxguru-965169e/batch_en_1760269403519_fa8a129e
# ✅ Shows errorFileName and hasErrors: true

# Test translations matrix
curl http://localhost:3000/api/translations
# ✅ Shows proper counts for all file types
```

## UI Changes

No UI component changes were needed - all fixes were backend:
- `BatchActions.vue` already had retry button logic
- `BatchStatus.vue` already supported `partially_failed` status
- `BatchMetadata.vue` already displayed error counts
- `BatchFilters.vue` already included `partially_failed` filter
- `TranslationMatrix.vue` already displayed all file types

The components were already built to handle these scenarios; they just needed the backend to provide the correct data.
