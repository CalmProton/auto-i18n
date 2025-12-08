<script setup lang="ts">
import { ref } from 'vue'
import { usePipelineEvents } from '../composables/usePipelineEvents'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  Activity,
  X,
  RefreshCw,
  Trash2,
  ChevronDown,
  Eye,
  Wifi,
  WifiOff,
  TestTube,
} from 'lucide-vue-next'

const props = defineProps<{
  senderId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const {
  events,
  logs,
  selectedEvent,
  selectedLog,
  stats,
  loading,
  sseConnected,
  stepStatuses,
  mockModeActive,
  fetchEvents,
  fetchEventDetail,
  fetchLogs,
  fetchLogDetail,
  fetchStats,
  clearLogs,
  cancelPipeline,
  restartPipeline,
} = usePipelineEvents(props.senderId)

const activeTab = ref('steps')
const showEventDialog = ref(false)
const showLogDialog = ref(false)
const expandedSteps = ref<Set<string>>(new Set())

// Status colors
const statusColors: Record<string, string> = {
  'started': 'bg-blue-500',
  'in-progress': 'bg-yellow-500',
  'completed': 'bg-green-500',
  'failed': 'bg-red-500',
  'cancelled': 'bg-gray-500',
  'retrying': 'bg-orange-500',
  'not-started': 'bg-gray-300',
}

// Toggle step expansion
const toggleStep = (step: string) => {
  if (expandedSteps.value.has(step)) {
    expandedSteps.value.delete(step)
  } else {
    expandedSteps.value.add(step)
  }
}

// View event detail
const viewEvent = async (eventId: string) => {
  await fetchEventDetail(eventId)
  showEventDialog.value = true
}

// View log detail
const viewLog = async (logId: string) => {
  await fetchLogDetail(logId)
  showLogDialog.value = true
}

// Format duration
const formatDuration = (ms?: number) => {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// Format date
const formatDate = (date?: string) => {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

// Step labels
const stepLabels: Record<string, string> = {
  'upload': 'File Upload',
  'batch-create': 'Create Batch',
  'batch-submit': 'Submit Batch',
  'batch-poll': 'Poll Status',
  'batch-process': 'Process Output',
  'translate': 'Translate Files',
  'github-finalize': 'GitHub Finalize',
  'github-pr': 'Create PR',
}

// Refresh data
const refresh = async () => {
  await Promise.all([fetchEvents(), fetchLogs(), fetchStats()])
}

// Get events for a specific step
const getEventsForStep = (step: string) => {
  return events.value.filter(e => e.step === step).slice(0, 10)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header with mode indicator -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Activity class="h-5 w-5" />
        <h3 class="text-lg font-semibold">Pipeline Details</h3>
        
        <!-- Mock mode indicator -->
        <Badge v-if="mockModeActive" variant="outline" class="gap-1 text-yellow-600 border-yellow-600">
          <TestTube class="h-3 w-3" />
          Mock Mode
        </Badge>
        
        <!-- SSE connection status -->
        <Badge :variant="sseConnected ? 'default' : 'destructive'" class="gap-1">
          <Wifi v-if="sseConnected" class="h-3 w-3" />
          <WifiOff v-else class="h-3 w-3" />
          {{ sseConnected ? 'Live' : 'Disconnected' }}
        </Badge>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" @click="refresh" :disabled="loading">
          <RefreshCw :class="['h-4 w-4', { 'animate-spin': loading }]" />
        </Button>
        <Button variant="ghost" size="sm" @click="clearLogs" class="text-destructive">
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-md border p-3 text-center">
        <div class="text-xl font-bold">{{ stats?.pipelineEvents ?? 0 }}</div>
        <div class="text-xs text-muted-foreground">Events</div>
      </div>
      <div class="rounded-md border p-3 text-center">
        <div class="text-xl font-bold">{{ stats?.apiRequestLogs ?? 0 }}</div>
        <div class="text-xs text-muted-foreground">API Calls</div>
      </div>
      <div class="rounded-md border p-3 text-center">
        <div class="text-xl font-bold">{{ stats?.batches ?? 0 }}</div>
        <div class="text-xs text-muted-foreground">Batches</div>
      </div>
    </div>

    <!-- Tabs -->
    <Tabs v-model="activeTab" class="w-full">
      <TabsList class="grid w-full grid-cols-3">
        <TabsTrigger value="steps">Steps</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="logs">API Logs</TabsTrigger>
      </TabsList>

      <!-- Steps View -->
      <TabsContent value="steps" class="space-y-3 mt-4">
        <div v-for="stepInfo in stepStatuses" :key="stepInfo.step" class="border rounded-lg">
          <div
            class="flex items-center justify-between w-full p-3 hover:bg-muted/50 cursor-pointer"
            @click="toggleStep(stepInfo.step)"
          >
            <div class="flex items-center gap-3">
              <div
                :class="[
                  'w-2 h-2 rounded-full',
                  statusColors[stepInfo.status] || 'bg-gray-300'
                ]"
              />
              <span class="font-medium">{{ stepLabels[stepInfo.step] || stepInfo.step }}</span>
              <Badge v-if="stepInfo.status !== 'not-started'" :variant="stepInfo.status === 'completed' ? 'default' : stepInfo.status === 'failed' ? 'destructive' : 'secondary'">
                {{ stepInfo.status }}
              </Badge>
            </div>
            <div class="flex items-center gap-2 text-muted-foreground text-sm">
              <span v-if="stepInfo.durationMs">{{ formatDuration(stepInfo.durationMs) }}</span>
              <ChevronDown
                :class="['h-4 w-4 transition-transform', { 'rotate-180': expandedSteps.has(stepInfo.step) }]"
              />
            </div>
          </div>
          <div v-if="expandedSteps.has(stepInfo.step)" class="px-3 pb-3">
            <div v-if="getEventsForStep(stepInfo.step).length > 0" class="space-y-2 mt-2">
              <div
                v-for="event in getEventsForStep(stepInfo.step)"
                :key="event.id"
                class="flex items-center justify-between p-2 rounded bg-muted/30 text-sm"
              >
                <div class="flex items-center gap-2">
                  <Badge :variant="event.status === 'completed' ? 'default' : event.status === 'failed' ? 'destructive' : 'secondary'">
                    {{ event.status }}
                  </Badge>
                  <span class="text-muted-foreground">{{ event.message }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">{{ formatDate(event.createdAt) }}</span>
                  <Button
                    v-if="event.hasRequestData || event.hasResponseData || event.hasErrorData"
                    variant="ghost"
                    size="sm"
                    @click.stop="viewEvent(event.id)"
                  >
                    <Eye class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
            <div v-else class="text-center text-muted-foreground text-sm py-4">
              No events for this step yet
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Events View -->
      <TabsContent value="events" class="mt-4">
        <div v-if="events.length === 0" class="text-center py-8 text-muted-foreground">
          No pipeline events recorded yet
        </div>
        <div v-else class="space-y-2 max-h-[400px] overflow-y-auto">
          <div
            v-for="event in events"
            :key="event.id"
            class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
          >
            <div class="flex items-center gap-3">
              <div
                :class="[
                  'w-2 h-2 rounded-full',
                  statusColors[event.status] || 'bg-gray-300'
                ]"
              />
              <div>
                <div class="font-medium">{{ stepLabels[event.step] || event.step }}</div>
                <div class="text-sm text-muted-foreground">{{ event.message }}</div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="event.durationMs" class="text-sm text-muted-foreground">
                {{ formatDuration(event.durationMs) }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ formatDate(event.createdAt) }}
              </span>
              <Button
                v-if="event.hasRequestData || event.hasResponseData || event.hasErrorData"
                variant="ghost"
                size="sm"
                @click="viewEvent(event.id)"
              >
                <Eye class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Logs View -->
      <TabsContent value="logs" class="mt-4">
        <div v-if="logs.length === 0" class="text-center py-8 text-muted-foreground">
          No API request logs recorded yet
        </div>
        <div v-else class="space-y-2 max-h-[400px] overflow-y-auto">
          <div
            v-for="log in logs"
            :key="log.id"
            class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
          >
            <div class="flex items-center gap-3">
              <Badge :variant="log.isMock ? 'outline' : 'default'">
                {{ log.provider }}
              </Badge>
              <div>
                <div class="font-medium flex items-center gap-2">
                  <span>{{ log.endpoint }}</span>
                  <Badge v-if="log.isMock" variant="outline" class="text-yellow-600 border-yellow-600">
                    Mock
                  </Badge>
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ log.filePath || 'N/A' }}
                  <span v-if="log.sourceLocale && log.targetLocale">
                    · {{ log.sourceLocale }} → {{ log.targetLocale }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <Badge :variant="log.responseStatus === 200 ? 'default' : 'destructive'">
                {{ log.responseStatus || 'N/A' }}
              </Badge>
              <span class="text-sm text-muted-foreground">
                {{ formatDuration(log.durationMs) }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ formatDate(log.createdAt) }}
              </span>
              <Button variant="ghost" size="sm" @click="viewLog(log.id)">
                <Eye class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>

    <!-- Pipeline Controls -->
    <div class="flex items-center justify-between pt-4 border-t">
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="cancelPipeline">
          <X class="h-4 w-4 mr-1" />
          Cancel
        </Button>
        <Button variant="outline" size="sm" @click="restartPipeline">
          <RefreshCw class="h-4 w-4 mr-1" />
          Restart
        </Button>
      </div>
      <Button variant="ghost" size="sm" @click="$emit('close')">
        Close
      </Button>
    </div>

    <!-- Event Detail Dialog -->
    <Dialog v-model:open="showEventDialog">
      <DialogContent class="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Event Details</DialogTitle>
          <DialogDescription>
            {{ stepLabels[selectedEvent?.step || ''] || selectedEvent?.step }} - {{ selectedEvent?.status }}
          </DialogDescription>
        </DialogHeader>
        <div v-if="selectedEvent" class="space-y-4">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="font-medium">Status:</span>
              <Badge :variant="selectedEvent.status === 'completed' ? 'default' : 'destructive'" class="ml-2">
                {{ selectedEvent.status }}
              </Badge>
            </div>
            <div>
              <span class="font-medium">Duration:</span>
              {{ formatDuration(selectedEvent.durationMs) }}
            </div>
            <div>
              <span class="font-medium">Created:</span>
              {{ formatDate(selectedEvent.createdAt) }}
            </div>
            <div v-if="selectedEvent.batchId">
              <span class="font-medium">Batch ID:</span>
              {{ selectedEvent.batchId }}
            </div>
          </div>
          <div v-if="selectedEvent.message" class="p-3 rounded bg-muted">
            <span class="font-medium">Message:</span>
            <p class="mt-1">{{ selectedEvent.message }}</p>
          </div>
          <div v-if="selectedEvent.requestData" class="space-y-2">
            <span class="font-medium">Request Data:</span>
            <pre class="p-3 rounded bg-muted text-xs overflow-x-auto">{{ JSON.stringify(selectedEvent.requestData, null, 2) }}</pre>
          </div>
          <div v-if="selectedEvent.responseData" class="space-y-2">
            <span class="font-medium">Response Data:</span>
            <pre class="p-3 rounded bg-muted text-xs overflow-x-auto">{{ JSON.stringify(selectedEvent.responseData, null, 2) }}</pre>
          </div>
          <div v-if="selectedEvent.errorData" class="space-y-2">
            <span class="font-medium text-destructive">Error:</span>
            <pre class="p-3 rounded bg-destructive/10 text-xs overflow-x-auto text-destructive">{{ JSON.stringify(selectedEvent.errorData, null, 2) }}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Log Detail Dialog -->
    <Dialog v-model:open="showLogDialog">
      <DialogContent class="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>API Request Details</DialogTitle>
          <DialogDescription>
            {{ selectedLog?.provider }} - {{ selectedLog?.endpoint }}
          </DialogDescription>
        </DialogHeader>
        <div v-if="selectedLog" class="space-y-4">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="font-medium">Method:</span>
              {{ selectedLog.method }}
            </div>
            <div>
              <span class="font-medium">Status:</span>
              <Badge :variant="selectedLog.responseStatus === 200 ? 'default' : 'destructive'" class="ml-2">
                {{ selectedLog.responseStatus }}
              </Badge>
            </div>
            <div>
              <span class="font-medium">Duration:</span>
              {{ formatDuration(selectedLog.durationMs) }}
            </div>
            <div>
              <span class="font-medium">Mock Mode:</span>
              {{ selectedLog.isMock ? 'Yes' : 'No' }}
            </div>
            <div v-if="selectedLog.filePath">
              <span class="font-medium">File:</span>
              {{ selectedLog.filePath }}
            </div>
            <div v-if="selectedLog.sourceLocale">
              <span class="font-medium">Locales:</span>
              {{ selectedLog.sourceLocale }} → {{ selectedLog.targetLocale }}
            </div>
          </div>
          <div v-if="selectedLog.requestBody" class="space-y-2">
            <span class="font-medium">Request Body:</span>
            <pre class="p-3 rounded bg-muted text-xs overflow-x-auto max-h-[200px]">{{ JSON.stringify(selectedLog.requestBody, null, 2) }}</pre>
          </div>
          <div v-if="selectedLog.responseBody" class="space-y-2">
            <span class="font-medium">Response Body:</span>
            <pre class="p-3 rounded bg-muted text-xs overflow-x-auto max-h-[200px]">{{ JSON.stringify(selectedLog.responseBody, null, 2) }}</pre>
          </div>
          <div v-if="selectedLog.errorMessage" class="space-y-2">
            <span class="font-medium text-destructive">Error:</span>
            <div class="p-3 rounded bg-destructive/10 text-destructive">
              <p>{{ selectedLog.errorMessage }}</p>
              <pre v-if="selectedLog.errorStack" class="mt-2 text-xs overflow-x-auto">{{ selectedLog.errorStack }}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
