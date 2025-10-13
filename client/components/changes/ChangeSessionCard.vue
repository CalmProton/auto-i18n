<script setup lang="ts">
import { ref } from 'vue'
import type { ChangeSession } from '../../types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { GitBranch, GitCommit, Play, CheckCircle, Trash2, ExternalLink, AlertCircle, RefreshCw } from 'lucide-vue-next'
import ChangesStepper from './ChangesStepper.vue'
import { useToast } from '../../composables'

interface Props {
  session: ChangeSession
}

const props = defineProps<Props>()
const emit = defineEmits<{
  process: [sessionId: string]
  finalize: [sessionId: string]
  delete: [sessionId: string]
  retryBatchOutput: [sessionId: string]
  retryPr: [sessionId: string]
  resetSession: [sessionId: string, full: boolean]
  refresh: []
}>()

const { error: showError } = useToast()
const processing = ref(false)
const deleting = ref(false)
const showAllErrors = ref(false)
const retrying = ref<string | null>(null)

const showToast = (options: { title: string; description: string; variant?: 'default' | 'destructive' }) => {
  if (options.variant === 'destructive') {
    showError(options.title, options.description)
  }
}

const statusVariant = (status: string) => {
  switch (status) {
    case 'completed':
    case 'pr-created':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'processing':
    case 'submitted':
      return 'secondary'
    default:
      return 'outline'
  }
}

const automationBadgeVariant = (mode: string) => {
  return mode === 'auto' ? 'default' : 'outline'
}

const handleProcess = async () => {
  processing.value = true
  try {
    emit('process', props.session.sessionId)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to process',
      variant: 'destructive'
    })
  } finally {
    processing.value = false
  }
}

const handleFinalize = async () => {
  processing.value = true
  try {
    emit('finalize', props.session.sessionId)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to finalize',
      variant: 'destructive'
    })
  } finally {
    processing.value = false
  }
}

const handleDelete = async () => {
  if (!confirm(`Delete change session ${props.session.sessionId}?`)) {
    return
  }
  
  deleting.value = true
  try {
    emit('delete', props.session.sessionId)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to delete',
      variant: 'destructive'
    })
  } finally {
    deleting.value = false
  }
}

const handleRetryBatchOutput = async () => {
  retrying.value = 'batch-output'
  try {
    emit('retryBatchOutput', props.session.sessionId)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to retry batch output',
      variant: 'destructive'
    })
  } finally {
    retrying.value = null
  }
}

const handleRetryPR = async () => {
  retrying.value = 'pr'
  try {
    emit('retryPr', props.session.sessionId)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to retry PR creation',
      variant: 'destructive'
    })
  } finally {
    retrying.value = null
  }
}

const handleResetSession = async (full = false) => {
  const confirmMessage = full
    ? 'Full reset will delete all translations and start from scratch. Are you sure?'
    : 'Reset PR status only? This will allow you to create a new PR with existing translations.'
  
  if (!confirm(confirmMessage)) {
    return
  }
  
  retrying.value = full ? 'full-reset' : 'reset'
  try {
    emit('resetSession', props.session.sessionId, full)
  } catch (error) {
    showToast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to reset session',
      variant: 'destructive'
    })
  } finally {
    retrying.value = null
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="space-y-1 flex-1">
          <CardTitle class="flex items-center gap-2">
            <GitBranch class="h-5 w-5" />
            <span>{{ session.repositoryName }}</span>
            <Badge :variant="statusVariant(session.status)" class="ml-2">
              {{ session.status }}
            </Badge>
            <Badge :variant="automationBadgeVariant(session.automationMode)" class="ml-1">
              {{ session.automationMode }}
            </Badge>
          </CardTitle>
          
          <CardDescription class="flex items-center gap-2 mt-2">
            <GitCommit class="h-4 w-4" />
            <span class="font-mono text-xs">{{ session.commit.shortSha }}</span>
            <span class="text-xs">{{ session.commit.message }}</span>
          </CardDescription>
          
          <div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{{ session.commit.author }}</span>
            <span>{{ new Date(session.commit.timestamp).toLocaleString() }}</span>
            <span>{{ session.sourceLocale }} → {{ session.targetLocales.length }} locales</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Button
            v-if="session.status === 'uploaded' && session.automationMode === 'manual'"
            size="sm"
            @click="handleProcess"
            :disabled="processing"
          >
            <Play class="h-4 w-4 mr-1" />
            Process
          </Button>

          <Button
            v-if="session.status === 'processing' && session.steps.submitted?.completed && !session.steps.completed?.completed"
            size="sm"
            @click="handleRetryBatchOutput"
            :disabled="retrying === 'batch-output'"
          >
            <Play class="h-4 w-4 mr-1" />
            Process Batch Output
          </Button>
          
          <Button
            v-if="session.status === 'completed' && session.automationMode === 'manual' && !session.steps.prCreated.completed"
            size="sm"
            @click="handleFinalize"
            :disabled="processing"
          >
            <CheckCircle class="h-4 w-4 mr-1" />
            Create PR
          </Button>

          <Button
            v-if="session.pullRequestUrl"
            size="sm"
            variant="outline"
            as="a"
            :href="session.pullRequestUrl"
            target="_blank"
          >
            <ExternalLink class="h-4 w-4 mr-1" />
            View PR
          </Button>

          <Button
            v-if="session.steps.prCreated?.completed && session.hasErrors"
            size="sm"
            variant="outline"
            @click="handleResetSession(false)"
            :disabled="retrying === 'reset' || retrying === 'full-reset'"
          >
            <RefreshCw class="h-4 w-4 mr-1" />
            Reset PR
          </Button>

          <Button
            v-if="session.hasErrors"
            size="sm"
            variant="destructive"
            @click="handleResetSession(true)"
            :disabled="retrying === 'reset' || retrying === 'full-reset'"
          >
            <RefreshCw class="h-4 w-4 mr-1" />
            Full Reset
          </Button>

          <Button
            size="sm"
            variant="ghost"
            @click="handleDelete"
            :disabled="deleting"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Change Summary -->
      <div class="flex items-center gap-4 text-sm">
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="text-green-600">
            +{{ session.changeCount.added }}
          </Badge>
          <span class="text-muted-foreground">added</span>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="text-blue-600">
            ~{{ session.changeCount.modified }}
          </Badge>
          <span class="text-muted-foreground">modified</span>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="text-red-600">
            -{{ session.changeCount.deleted }}
          </Badge>
          <span class="text-muted-foreground">deleted</span>
        </div>
      </div>

      <!-- Progress Stepper -->
      <div class="py-4">
        <ChangesStepper :steps="session.steps" orientation="horizontal" />
      </div>

      <!-- Errors -->
      <div v-if="session.hasErrors" class="rounded-md bg-destructive/10 p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 text-sm text-destructive font-medium">
            <AlertCircle class="h-4 w-4" />
            {{ session.errorCount }} error(s)
          </div>
          <div class="flex items-center gap-2">
            <Button
              v-if="session.hasErrors"
              size="sm"
              variant="outline"
              @click="handleRetryBatchOutput"
              :disabled="retrying === 'batch-output'"
              class="h-6 text-xs"
            >
              Retry Output
            </Button>
            <Button
              v-if="session.status === 'completed' && !session.steps.prCreated.completed && session.hasErrors"
              size="sm"
              variant="outline"
              @click="handleRetryPR"
              :disabled="retrying === 'pr'"
              class="h-6 text-xs"
            >
              Retry PR
            </Button>
            <Button
              size="sm"
              variant="ghost"
              @click="showAllErrors = !showAllErrors"
              class="h-6 text-xs"
            >
              {{ showAllErrors ? 'Hide' : 'Show All' }}
            </Button>
          </div>
        </div>
        <div v-if="session.errors" class="space-y-2">
          <div
            v-for="(error, index) in (showAllErrors ? session.errors : session.errors.slice(0, 3))"
            :key="index"
            class="rounded bg-background/50 p-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 space-y-1">
                <div class="text-xs font-medium text-destructive">{{ error.step }}</div>
                <div class="text-xs text-muted-foreground break-words">{{ error.message }}</div>
                <div class="text-[10px] text-muted-foreground">
                  {{ new Date(error.timestamp).toLocaleString() }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="!showAllErrors && session.errors.length > 3" class="text-xs text-muted-foreground text-center">
            ...and {{ session.errors.length - 3 }} more (click "Show All" to expand)
          </div>
        </div>
      </div>

      <!-- Deletion PR -->
      <div v-if="session.deletionPullRequest" class="rounded-md bg-muted p-3">
        <div class="flex items-center justify-between">
          <div class="text-sm">
            <span class="font-medium">Deletion PR created:</span>
            <span class="text-muted-foreground ml-2">#{{ session.deletionPullRequest.number }}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            as="a"
            :href="session.deletionPullRequest.url"
            target="_blank"
          >
            <ExternalLink class="h-4 w-4 mr-1" />
            View
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
