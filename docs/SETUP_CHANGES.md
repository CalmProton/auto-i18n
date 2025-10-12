# Setting Up Automatic Translation Changes

This guide explains how to set up automatic incremental translation updates for your repository.

## Prerequisites

- Auto-i18n server running and accessible
- GitHub repository with content to translate
- GitHub Actions enabled in your repository

## Step 1: Configure Repository Variables

In your GitHub repository, go to Settings → Secrets and variables → Actions → Variables tab, and add:

### Required Variables

1. **AUTO_I18N_ENDPOINT**
   - Your translation service URL
   - Example: `https://auto-i18n.example.com`

### Optional Variables

2. **AUTO_I18N_TARGET_LOCALES**
   - Comma-separated list of target languages
   - Default: `ru,zh,hi,es,fr,ar,bn,pt,id,de,ja,ko,tr,vi,it,fa,pl,nl,ro,el,cs,hu,sv,bg,da,fi,sk,hr,no,sl,sr`
   - Example: `es,fr,de`

3. **AUTO_I18N_AUTOMATION_MODE**
   - `auto` - Automatically process translations and create PRs
   - `manual` - Require manual approval in dashboard for each step
   - Default: `auto`

## Step 2: Add Secret (if using authentication)

If your Auto-i18n server requires authentication, add a Secret:

1. **AUTO_I18N_ACCESS_KEY**
   - Your access key for the translation service
   - Go to Settings → Secrets and variables → Actions → Secrets tab

## Step 3: Add Workflow File

Copy the workflow file from `examples/workflows/changes.yml` to your repository:

```bash
mkdir -p .github/workflows
cp examples/workflows/changes.yml .github/workflows/auto-i18n-changes.yml
```

Or create `.github/workflows/auto-i18n-changes.yml` with the content from the example.

## Step 4: Adjust Monitored Paths (Optional)

Edit the workflow file to match your repository structure. By default, it monitors:

```yaml
on:
  push:
    branches: [main, master]
    paths:
      - 'content/en/**/*.md'
      - 'i18n/locales/en.json'
      - 'i18n/locales/pages/**/*.json'
```

Change the paths to match your repository structure.

## Step 5: Commit and Push

```bash
git add .github/workflows/auto-i18n-changes.yml
git commit -m "Add automatic translation changes workflow"
git push
```

## How It Works

### Automatic Mode (automation mode = auto)

1. You push changes to monitored files
2. GitHub Actions workflow detects the changes
3. Changes are sent to the translation service
4. Translation batch is created automatically
5. Batch is submitted to OpenAI
6. System polls for completion
7. Translations are processed
8. GitHub PR is created automatically with translations
9. Separate PR is created for any deleted keys (if applicable)

### Manual Mode (automation mode = manual)

1. You push changes to monitored files
2. GitHub Actions workflow detects and uploads the changes
3. Changes appear in the Dashboard "Changes" tab
4. You review the changes in the dashboard
5. You click "Process" to create and submit the batch
6. System processes translations
7. You click "Create PR" to generate the pull request

## Dashboard

Access the dashboard at your Auto-i18n server URL to:

- View all change sessions
- Monitor translation progress with visual stepper
- Process changes manually (if in manual mode)
- Create PRs manually (if in manual mode)
- View errors and troubleshoot issues
- Delete stale sessions

Navigate to the "Changes" tab or press `Alt+3`.

## Session ID Format

Each change creates a unique session:
- Format: `{owner}-{repo}-{commit-sha-7}`
- Example: `myorg-myrepo-abc1234`

This ensures each commit gets its own translation session, even if multiple commits happen quickly.

## File Change Types

The system handles three types of changes:

1. **Added** - New files or new keys in JSON files
2. **Modified** - Changed files or changed key values in JSON files
3. **Deleted** - Removed files or removed keys from JSON files

## Translation Strategy

### For JSON Files (i18n/locales/*.json)
- System fetches the previous version from GitHub
- Extracts delta (added, modified, deleted keys)
- Translates only the changed keys
- Merges translated keys back into full files
- Creates PR with complete files

### For Markdown Files (content/**/*.md)
- Translates the entire file
- Preserves frontmatter and structure
- Creates PR with translated files

### For Deleted Keys
- Creates a separate PR for deletions
- Allows review before removing translations from all languages

## Troubleshooting

### Workflow Not Triggering
- Check that paths match your repository structure
- Verify you're pushing to the correct branch (main or master)
- Check GitHub Actions permissions

### Authentication Errors
- Verify `AUTO_I18N_ACCESS_KEY` secret is set correctly
- Check that your access key is valid

### Changes Not Appearing in Dashboard
- Verify `AUTO_I18N_ENDPOINT` variable is correct and accessible
- Check workflow logs in GitHub Actions for errors
- Verify your server is running

### Translations Not Completing
- Check OpenAI API key is configured on the server
- Review the session errors in the dashboard
- Check server logs for detailed error messages

## Advanced Configuration

### Custom Target Locales Per Push

You can override target locales in the workflow file by modifying the `TARGET_LOCALES` variable:

```yaml
- name: Send changes to translation service
  env:
    TARGET_LOCALES: "es,fr,de"  # Only these three languages
```

### Different Automation Modes

You can set automation mode per workflow run:

```yaml
- name: Send changes to translation service
  env:
    AUTOMATION_MODE: "manual"  # Force manual mode
```

### Custom Branch Strategy

Modify the workflow to trigger on different branches:

```yaml
on:
  push:
    branches: [develop, staging]  # Your custom branches
```

## Benefits

- **Efficiency**: Only translates what changed, not entire files
- **Cost Savings**: Fewer tokens sent to translation API
- **Speed**: Faster turnaround for small changes
- **Automation**: Set and forget (in auto mode)
- **Visibility**: Clear progress tracking in dashboard
- **Safety**: Manual approval option for critical changes
