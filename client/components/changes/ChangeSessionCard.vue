<script setup lang="ts">
import { ref } from 'vue'
import type { ChangeSession } from '../../types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { GitBranch, GitCommit, Play, CheckCircle, Trash2, ExternalLink, AlertCircle } from 'lucide-vue-next'
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
  refresh: []
}>()

const { showToast } = useToast()
const processing = ref(false)
const deleting = ref(false)

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
        <div class="flex items-center gap-2 text-sm text-destructive font-medium mb-2">
          <AlertCircle class="h-4 w-4" />
          {{ session.errorCount }} error(s)
        </div>
        <div v-if="session.errors" class="space-y-1">
          <div
            v-for="(error, index) in session.errors.slice(0, 3)"
            :key="index"
            class="text-xs text-muted-foreground"
          >
            <span class="font-medium">{{ error.step }}:</span> {{ error.message }}
          </div>
          <div v-if="session.errors.length > 3" class="text-xs text-muted-foreground">
            ...and {{ session.errors.length - 3 }} more
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
