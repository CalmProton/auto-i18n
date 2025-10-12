# UI Implementation Plan - Executive Summary

## 🎯 Goal
Transform the current upload-focused UI into a comprehensive dashboard for managing translation jobs, batches, and GitHub integration.

## 📊 What You'll See

### 4 Main Tabs:

1. **Uploads Tab** 
   - See all upload sessions (e.g., `calmproton-pxguru-965169e`)
   - View repo name, locales, file counts
   - Actions: Trigger translation, Create batch, Delete

2. **Batches Tab**
   - See all translation batches with real-time status
   - Progress bars showing completion (e.g., "420/1200 requests")
   - Error counts and retry options
   - Actions: Refresh status, Process output, Retry failed, View details

3. **Translations Tab**
   - Matrix view: locales × file types (content/global/page)
   - Visual indicators: ✅ Complete, ⚠️ Partial, ❌ Missing
   - Overall completion percentage
   - Actions: View files, Download, Mark ready for PR

4. **GitHub Tab**
   - Sessions ready for PR creation
   - Select which locales to include (checkbox list)
   - Configure PR metadata (title, branch)
   - Create PR with selected languages

## 🔧 What Needs to Be Built

### Backend (20 New API Endpoints)
- **Uploads APIs** (5 endpoints): List, details, trigger, delete
- **Batches APIs** (6 endpoints): List, details, refresh, process, retry, delete
- **Translations APIs** (4 endpoints): List, status matrix, file access
- **GitHub APIs** (3 endpoints): Ready list, enhanced finalize, status check
- **Utility APIs** (2 endpoints): System stats, supported locales

### Frontend (New Components)
- Dashboard layout with tab navigation
- Upload cards with metadata and actions
- Batch cards with status/progress indicators
- Translation matrix visualization
- GitHub PR creation form with locale selection
- Various dialogs (batch details, retry, delete confirmation)

## ⏱️ Timeline

**Total Estimated Time: 7-11 days**

- Phase 1: Backend APIs (1-2 days)
- Phase 2: Frontend composables (1 day)
- Phase 3: Core UI components (2-3 days)
- Phase 4: Advanced UI (2-3 days)
- Phase 5: Polish & testing (1-2 days)
- Phase 6: Documentation (0.5 day)

## 🎨 Key Features

✨ **Real-time Batch Monitoring**
- Auto-refresh every 30s for processing batches
- Manual refresh always available

✨ **Smart Translation Status**
- Visual matrix showing which locales are complete
- Missing file detection
- One-click retrigger for failed translations

✨ **Flexible PR Creation**
- Choose which locales to include in PR
- Override metadata from uploads
- Preview before creating

✨ **Error Recovery**
- Retry failed batch requests with one click
- View error details
- Track retry batch lineage

## 📝 Your Answers Needed

Before implementation, please clarify:

1. **Pagination**: Page size for lists? (Recommend 20 items)
2. **Auto-refresh**: Refresh interval for batches? (Recommend 30s)
3. **File Preview**: Show file content in UI? (Markdown/JSON preview)
4. **Smart Defaults**: Auto-select only completed locales in GitHub tab?
5. **Cascade Delete**: Delete batches/translations when deleting upload?
6. **Export**: Support ZIP download of translations?
7. **Undo**: Soft-delete with undo option?
8. **Multi-user**: Plan for authentication in future?

## 📋 Next Steps

1. **Review this plan** - Any adjustments needed?
2. **Answer clarification questions** above
3. **Approve to proceed** - I'll start with Phase 1 (Backend APIs)

---

**Full detailed plan:** See `UI_IMPLEMENTATION_PLAN.md`
