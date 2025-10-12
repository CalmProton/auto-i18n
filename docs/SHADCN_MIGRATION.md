# shadcn-vue Migration Summary

## Completed Migrations

### Main Components
- ✅ **App.vue** - Added TooltipProvider wrapper
- ✅ **DashboardLayout.vue** - Replaced Icon with lucide-vue-next icons, added Tooltip, Kbd
- ✅ **KeyboardShortcutsHelp.vue** - Migrated to Dialog and Kbd components
- ✅ **StatsOverview.vue** - Added lucide icons, Badge, Spinner
- ✅ **ToastContainer.vue** - Added lucide icons, proper Button component
- ✅ **UploadsTab.vue** - Added lucide icons, Dialog, Spinner
- ✅ **BatchesTab.vue** - Added lucide icons, Spinner
- ✅ **TranslationsTab.vue** - Added lucide icons, Spinner
- ✅ **GitHubTab.vue** - Added lucide icons, Skeleton

### Sub-components
- ✅ **batches/BatchFilters.vue** - Migrated to Select component with lucide icons

## Icon Migration Map (mdi → lucide-vue-next)

| Old (mdi) | New (lucide-vue-next) |
|-----------|----------------------|
| mdi:translate | Languages |
| mdi:upload | Upload, UploadCloud |
| mdi:progress-clock, mdi:chart-box | Timer, Clock |
| mdi:github | Github |
| mdi:keyboard | Keyboard |
| mdi:close | X |
| mdi:refresh | RefreshCw |
| mdi:check-circle | CheckCircle |
| mdi:close-circle, mdi:alert-circle | XCircle, AlertCircle |
| mdi:file-document-multiple | FileText, Files |
| mdi:file-multiple | Files |
| mdi:web | Globe |
| mdi:source-pull | GitPullRequest |
| mdi:rocket-launch | Rocket |
| mdi:source-repository | FolderGit |
| mdi:source-branch | GitBranch |
| mdi:lock | Lock |
| mdi:loading | Loader2 (with animate-spin) |
| mdi:circle | CircleDot |
| mdi:clipboard-list | ClipboardList |
| mdi:file-download | Download |
| mdi:file-export | FileOutput |

## Remaining Components to Migrate

### High Priority
- [ ] **AuthGuard.vue** - Replace Icon with Lock from lucide
- [ ] **ContentUpload.vue** - Replace Icons (FileText, CheckCircle, XCircle, Rocket)
- [ ] **GlobalUpload.vue** - Replace Icons (Globe, CheckCircle, XCircle, Rocket)
- [ ] **PageUpload.vue** - Replace Icons (Files, CheckCircle, XCircle, Rocket)
- [ ] **GitHubFinalize.vue** - Replace Icons (GitPullRequest, CheckCircle, XCircle)
- [ ] **BatchStatus.vue** - Replace Icons (Timer, ClipboardList, XCircle)

### Sub-components (uploads/)
- [ ] **uploads/UploadCard.vue**
- [ ] **uploads/UploadActions.vue** - Replace GitPullRequest icon
- [ ] **uploads/FilesList.vue** - Replace FileText, Globe, Files icons
- [ ] **uploads/UploadMetadata.vue**

### Sub-components (batches/)
- [ ] **batches/BatchCard.vue**
- [ ] **batches/BatchesList.vue**
- [ ] **batches/BatchDetails.vue** - Replace FileText, Download, AlertCircle icons
- [ ] **batches/BatchActions.vue**
- [ ] **batches/BatchMetadata.vue**

### Sub-components (translations/)
- [ ] **translations/TranslationsList.vue**
- [ ] **translations/TranslationSessionCard.vue**
- [ ] **translations/TranslationMatrix.vue**
- [ ] **translations/TranslationActions.vue** - Replace GitPullRequest, FileOutput icons
- [ ] **translations/FileStatusBadge.vue**
- [ ] **translations/CompletionBadge.vue**

### Sub-components (github/)
- [ ] **github/GitHubSessionCard.vue** - Replace FolderGit, GitBranch, Languages icons
- [ ] **github/ReadySessions.vue**
- [ ] **github/ExistingPRsList.vue** - Replace FolderGit, GitBranch icons
- [ ] **github/CreatePRButton.vue** - Replace CheckCircle, Loader2, Rocket icons
- [ ] **github/PRMetadataForm.vue**
- [ ] **github/LocaleSelector.vue**

## Component Guidelines

### Icon Usage
- Always import from `lucide-vue-next`
- Use consistent size: `class="h-4 w-4"` for inline, `class="h-8 w-8"` or `class="h-12 w-12"` for large
- Remove color props - use Tailwind classes instead

### Button Usage
- Always use shadcn Button component
- Variants: `default`, `destructive`, `outline`, `ghost`, `link`
- Sizes: `default`, `sm`, `lg`, `icon`

### Loading States
- Use `<Spinner>` component instead of custom loading text
- For skeleton loading, use `<Skeleton>` component

### Keyboard Shortcuts
- Use `<Kbd>` component for keyboard keys
- Example: `<Kbd>Alt</Kbd>` + `<Kbd>1</Kbd>`

### Dialogs/Modals
- Use Dialog component instead of custom modals
- Structure: Dialog → DialogContent → DialogHeader → DialogTitle/Description → DialogFooter

### Selects/Dropdowns
- Use Select component instead of native select elements
- Structure: Select → SelectTrigger → SelectValue + SelectContent → SelectItem

## Next Steps
1. Migrate high-priority components (AuthGuard, Upload forms)
2. Migrate batch sub-components
3. Migrate translation sub-components
4. Migrate github sub-components
5. Final cleanup and remove unused Icon.vue component
