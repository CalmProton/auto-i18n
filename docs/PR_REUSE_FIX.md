# PR Reuse Fix - Prevent Duplicate PRs on Retry

## Problem

When retrying a failed change session, the system was:
1. Creating a new issue ✅
2. Creating a new commit ✅
3. **Trying to create a new PR** ❌

But since the branch name was the same, GitHub rejected it with:
```
422 Unprocessable Entity
"A pull request already exists for CalmProton:auto-i18n/changes-calmproton-pxgu-20251013."
```

## Root Cause

The workflow always tried to create a **new PR**, even when one already existed. The branch name was deterministic (based on sessionId + date), so retries on the same day would use the same branch.

## Solution

Implement **PR reuse logic**:

1. **Save branch name** when PR is first created
2. **Check if PR exists** before creating new one
3. **Reuse existing branch** if PR was already created
4. **Add new commits** to existing PR instead of creating duplicate

## Changes Made

### 1. Type Updates

**File**: `server/types/index.ts`

Added `branchName` to the `prCreated` step:

```typescript
prCreated: StepStatus & { 
  pullRequestNumber?: number
  pullRequestUrl?: string
  branchName?: string  // NEW
}
```

### 2. Workflow Logic

**File**: `server/services/github/changeWorkflow.ts`

#### Branch Name Reuse

```typescript
// BEFORE: Always created new branch
const branchName = `auto-i18n/changes-${sessionId}-${timestamp}`

// AFTER: Reuse if PR exists, otherwise create unique
if (metadata.steps.prCreated?.completed && metadata.steps.prCreated?.branchName) {
  branchName = metadata.steps.prCreated.branchName
  log.info('Reusing existing branch', { sessionId, branchName })
} else {
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const timeComponent = Date.now().toString().slice(-6)
  branchName = `auto-i18n/changes-${sessionId}-${timestamp}-${timeComponent}`
  log.info('Creating new branch', { sessionId, branchName })
}
```

#### PR Creation/Update Logic

```typescript
// BEFORE: Always tried to create new PR
const pr = await client.createPullRequest({ ... })

// AFTER: Check if PR exists first
if (metadata.steps.prCreated?.completed && metadata.steps.prCreated?.pullRequestNumber) {
  // PR already exists, reuse it
  pr = {
    number: metadata.steps.prCreated.pullRequestNumber,
    html_url: metadata.steps.prCreated.pullRequestUrl
  }
  log.info('✅ Updated existing pull request with new commit', { ... })
} else {
  // Create new pull request
  pr = await client.createPullRequest({ ... })
  log.info('✅ Created pull request for change session', { ... })
}
```

### 3. Save Branch Name

**File**: `server/routes/changes.ts`

Updated both retry endpoints to save `branchName`:

```typescript
await updateChangeSessionStatus(sessionId, 'pr-created', {
  prCreated: {
    completed: true,
    timestamp: new Date().toISOString(),
    pullRequestNumber: result.pullRequestNumber,
    pullRequestUrl: result.pullRequestUrl,
    branchName: result.branchName  // NEW
  }
})
```

## Flow Diagrams

### First Attempt (Creates New PR)

```
┌─────────────────────────────┐
│ Batch Output Processing     │
│ ✅ Success                   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Generate Branch Name        │
│ auto-i18n/changes-...-12345 │ ← Unique timestamp
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Create Branch & Commit      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Create New Pull Request     │ ← NEW PR #224
│ Save: PR #224, branch name  │
└─────────────────────────────┘
```

### Retry (Reuses Existing PR)

```
┌─────────────────────────────┐
│ Click "Retry Output"        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Batch Output Processing     │
│ ✅ Success (with fixes)      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Check Existing PR           │
│ Found: PR #224, branch name │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Reuse Branch Name           │
│ auto-i18n/changes-...-12345 │ ← SAME branch
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Add New Commit to Branch    │
│ (PR #224 auto-updates)      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Skip PR Creation            │
│ Return existing PR #224     │ ← REUSED
└─────────────────────────────┘
```

## Behavior

### Scenario 1: First Run Success

```bash
# First attempt
✅ Batch completed
✅ Output processed
✅ Branch created: auto-i18n/changes-calmproton-pxgu-20251013-357698
✅ PR created: #224
```

**Result**: New PR #224 with branch `auto-i18n/changes-calmproton-pxgu-20251013-357698`

### Scenario 2: First Run Failed, Then Retry

```bash
# First attempt
✅ Batch completed
❌ Output processing failed
❌ No PR created

# Fix code, then retry
✅ Batch output reprocessed
✅ Branch created: auto-i18n/changes-calmproton-pxgu-20251013-854721
✅ PR created: #225
```

**Result**: New PR #225 with unique branch name (different timestamp)

### Scenario 3: PR Created, Then Output Fails, Then Retry

```bash
# First attempt
✅ Batch completed
✅ Output processed (incomplete)
✅ PR created: #224 with branch auto-i18n/changes-calmproton-pxgu-20251013-357698

# Fix code, then retry
✅ Batch output reprocessed (fixed)
✅ Branch reused: auto-i18n/changes-calmproton-pxgu-20251013-357698
✅ New commit added to existing branch
✅ PR #224 automatically updated with new commit
```

**Result**: Same PR #224 updated with new commits

## Benefits

1. **No Duplicate PRs** - Retries don't create redundant PRs
2. **Clean PR History** - All retry commits appear in the same PR
3. **Better Review** - Reviewers see all attempts in one place
4. **Atomic Changes** - One PR per change session, not per retry

## Testing

### Test Case 1: Fresh Session

```bash
# First time creating PR
curl -X POST http://localhost:3000/translate/changes/test-session-123/retry-pr
```

**Expected**: New PR created, branch name saved

### Test Case 2: Retry After PR Created

```bash
# PR already exists (e.g., PR #224)
curl -X POST http://localhost:3000/translate/changes/test-session-123/retry-output
```

**Expected**: 
- Reuses same branch name
- Adds commit to existing branch
- PR #224 updates automatically
- No new PR created

### Test Case 3: Check Metadata

```bash
# After PR creation
cat tmp/test-session-123/changes/metadata.json
```

**Expected**: `prCreated.branchName` field populated

## Troubleshooting

### Issue: Still Getting "PR Already Exists" Error

**Cause**: Metadata doesn't have `branchName` saved from first PR creation

**Solution**: 
1. Check `metadata.json` → `steps.prCreated.branchName`
2. If missing, close old PR or delete old branch
3. Retry will create new branch with unique timestamp

### Issue: Commits Not Showing in PR

**Cause**: Using wrong branch name

**Solution**: Verify branch name in GitHub matches `prCreated.branchName` in metadata

## Future Enhancements

- [ ] Add "Force New PR" option to create separate PR for retry
- [ ] Link related PRs in PR description
- [ ] Add retry count to commit messages
- [ ] Support PR branch cleanup on session deletion
