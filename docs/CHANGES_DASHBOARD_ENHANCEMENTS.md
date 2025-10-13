# Changes Dashboard Enhancements

## Summary of Changes

Added two major enhancements to the Changes tab dashboard:

1. **Expanded Error Display** - Show all error details with timestamps
2. **Manual Retry Buttons** - Restart failed pipeline steps without reprocessing

## Features Added

### 1. Error Details Expansion

**Before:**
- Only showed first 3 errors
- Limited information (step name + message)
- No way to see all errors

**After:**
- "Show All" / "Hide" button to expand all errors
- Each error displayed in its own card with:
  - Step name (highlighted)
  - Full error message (word-wrapped)
  - Timestamp
- Better visual hierarchy

### 2. Manual Retry Actions

**New Endpoints:**
- `POST /translate/changes/:sessionId/retry-batch-output` - Reprocess batch output files
- `POST /translate/changes/:sessionId/retry-pr` - Retry PR creation

**Retry Flow:**

```
┌─────────────────────┐
│ Batch Completed     │
│ (with errors)       │
└──────┬──────────────┘
       │
       ├─► User clicks "Retry Output"
       │   └─► POST /retry-batch-output
       │       ├─► Reprocess batch output
       │       ├─► Merge deltas with repo files
       │       └─► Auto-trigger PR creation
       │
       └─► User clicks "Retry PR"
           └─► POST /retry-pr
               ├─► Fetch translation files
               ├─► Create GitHub branch
               ├─► Commit changes
               └─► Open pull request
```

**Button Visibility:**
- **Retry Output**: Shows when `status === 'completed'` AND `hasErrors === true`
- **Retry PR**: Shows when `status === 'completed'` AND `!steps.prCreated.completed`

## Files Modified

### Backend

**server/routes/changes.ts**
- Added `POST /:sessionId/retry-batch-output` endpoint
  - Calls `processDeltaBatchOutput()`
  - Auto-triggers PR creation on success
  - Updates session status and steps
- Added `POST /:sessionId/retry-pr` endpoint
  - Calls `createChangePR()`
  - Updates session status with PR details

### Frontend

**client/composables/useChanges.ts**
- Added `retryBatchOutput(sessionId)` function
- Added `retryPR(sessionId)` function
- Exported both in return object

**client/components/ChangesTab.vue**
- Imported retry functions from composable
- Created `handleRetryBatchOutput()` wrapper with pause/resume
- Created `handleRetryPR()` wrapper with pause/resume
- Passed handlers to ChangeSessionCard via emit

**client/components/changes/ChangeSessionCard.vue**
- Added emit definitions for `retryBatchOutput` and `retryPr`
- Created `showAllErrors` ref for expansion state
- Created `retrying` ref to track current retry operation
- Added `handleRetryBatchOutput()` and `handleRetryPR()` handlers
- Enhanced error display with:
  - Individual error cards with full details
  - "Show All" / "Hide" toggle button
  - "Retry Output" button (conditional)
  - "Retry PR" button (conditional)
  - Timestamps for each error

## Usage

### Viewing All Errors

1. Navigate to Changes tab
2. Find a session with errors (shows "N error(s)")
3. Click "Show All" button to expand all errors
4. Each error shows step, message, and timestamp

### Retrying Failed Steps

#### Scenario 1: Batch Output Processing Failed

```
Status: completed
Errors: "No translation files found"
```

**Action:**
1. Click "Retry Output" button
2. System reprocesses the batch output with fixed logic
3. Translation files created and merged with repo
4. PR automatically created if processing succeeds

#### Scenario 2: PR Creation Failed

```
Status: completed
Errors: "GitHub API request failed: 422"
```

**Action:**
1. Click "Retry PR" button
2. System retries PR creation
3. Uses existing translation files
4. Creates branch, commits, and opens PR

## Error Handling

- All retry operations show loading state (button disabled)
- Errors displayed via toast notifications
- Session automatically refreshes after retry
- Dashboard list updates with new status
- Polling service continues in background

## Benefits

1. **Better Debugging** - See full error messages and timestamps
2. **No Reprocessing** - Retry from failure point, don't start over
3. **Save API Costs** - Don't recreate batches when only PR failed
4. **User Control** - Manual intervention for automated workflows
5. **Clear Status** - Know exactly what failed and when

## Example Use Cases

### Case 1: Output Processor Bug

```
Initial run:
- Batch completed successfully (31/31)
- Output processing failed (wrong file paths)
- Errors recorded

After fix:
1. Deploy code fix
2. Click "Retry Output" 
3. Output processes correctly
4. PR created automatically
```

### Case 2: GitHub Rate Limit

```
Initial run:
- Batch completed
- Output processed
- PR creation hit rate limit

After rate limit clears:
1. Click "Retry PR"
2. PR created successfully
3. No need to reprocess translations
```

### Case 3: Permission Issues

```
Initial run:
- Batch completed
- Output processed
- PR failed: "GitHub API 422 Unprocessable"

After fixing permissions:
1. Click "Retry PR"
2. PR created with correct permissions
```

## Testing

### Test Retry Output

```bash
# Manually call endpoint
curl -X POST http://localhost:3000/translate/changes/calmproton-pxguru-804c881/retry-batch-output

# Expected: 
# - Reprocesses batch output
# - Creates translation files
# - Triggers PR creation
```

### Test Retry PR

```bash
# Manually call endpoint  
curl -X POST http://localhost:3000/translate/changes/calmproton-pxguru-804c881/retry-pr

# Expected:
# - Uses existing translation files
# - Creates GitHub PR
# - Updates session status
```

## Future Enhancements

- [ ] Retry individual batch requests (not whole batch)
- [ ] Retry from any step (not just output/PR)
- [ ] Show retry history in session metadata
- [ ] Add "Retry All Failed" bulk action
- [ ] Export error logs to file
