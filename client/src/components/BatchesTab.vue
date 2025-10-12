<template>
  <div class="space-y-6">
    <!-- Header with filters and actions -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold">Batch Jobs</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Monitor and manage translation batch operations
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" @click="refresh" :disabled="loading">
          <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
      </div>
    </div>

    <!-- Filters -->
    <BatchFilters
      :status-filter="statusFilter"
      :sender-filter="senderFilter"
      @update:status-filter="statusFilter = $event"
      @update:sender-filter="senderFilter = $event"
      @clear-filters="clearFilters"
    />

    <!-- Loading State -->
    <div v-if="loading && !batches.length" class="flex items-center justify-center py-12">
      <div class="text-center space-y-4">
        <Spinner class="h-8 w-8 mx-auto" />
        <div>
          <p class="text-lg font-medium">Loading batches...</p>
          <p class="text-sm text-muted-foreground">Please wait</p>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <Alert v-else-if="error" variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Empty State -->
    <div v-else-if="!batches.length" class="flex items-center justify-center py-12 border-2 border-dashed rounded-lg">
      <div class="text-center space-y-4">
        <Layers class="h-12 w-12 mx-auto text-muted-foreground" />
        <div>
          <p class="text-lg font-medium">No batches found</p>
          <p class="text-sm text-muted-foreground">
            {{ statusFilter !== 'all' ? 'Try changing the filter' : 'Batches will appear here when created' }}
          </p>
        </div>
      </div>
    </div>

    <!-- Batches List -->
    <BatchesList v-else :batches="batches" @refresh="refresh" />

    <!-- Pagination -->
    <div v-if="pagination && pagination.hasMore" class="flex justify-center">
      <Button variant="outline" @click="loadMore" :disabled="loading">
        <ChevronDown class="h-4 w-4 mr-2" />
        Load More
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useBatches } from '@/composables'
import { RefreshCw, AlertCircle, Layers, ChevronDown } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import BatchFilters from './batches/BatchFilters.vue'
import BatchesList from './batches/BatchesList.vue'
import type { BatchStatus } from '@/types/api'

const { batches, pagination, loading, error, fetchBatches } = useBatches()

const statusFilter = ref<BatchStatus | 'all'>('all')
const senderFilter = ref<string>('')
let currentOffset = 0

onMounted(() => {
  loadBatches()
})

// Watch filters and reload
watch([statusFilter, senderFilter], () => {
  currentOffset = 0
  loadBatches()
})

function loadBatches() {
  const params: any = { limit: 50, offset: currentOffset }
  if (statusFilter.value !== 'all') {
    params.status = statusFilter.value
  }
  if (senderFilter.value) {
    params.senderId = senderFilter.value
  }
  fetchBatches(params)
}

function refresh() {
  currentOffset = 0
  loadBatches()
}

function loadMore() {
  currentOffset += 50
  loadBatches()
}

function clearFilters() {
  statusFilter.value = 'all'
  senderFilter.value = ''
}
</script>
