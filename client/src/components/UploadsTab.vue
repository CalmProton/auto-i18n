<template>
  <div class="space-y-6">
    <!-- Header with actions -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold">Upload Sessions</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Manage your uploaded files and trigger translations
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" @click="refresh" :disabled="loading">
          <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
        <Button @click="showCreateUpload = true">
          <Plus class="h-4 w-4 mr-2" />
          New Upload
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !uploads.length" class="flex items-center justify-center py-12">
      <div class="text-center space-y-4">
        <Spinner class="h-8 w-8 mx-auto" />
        <div>
          <p class="text-lg font-medium">Loading uploads...</p>
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
    <div v-else-if="!uploads.length" class="flex items-center justify-center py-12 border-2 border-dashed rounded-lg">
      <div class="text-center space-y-4">
        <UploadCloud class="h-12 w-12 mx-auto text-muted-foreground" />
        <div>
          <p class="text-lg font-medium">No uploads yet</p>
          <p class="text-sm text-muted-foreground">Create your first upload session to get started</p>
        </div>
        <Button @click="showCreateUpload = true">
          <Plus class="h-4 w-4 mr-2" />
          Create Upload
        </Button>
      </div>
    </div>

    <!-- Uploads List -->
    <UploadsList v-else :uploads="uploads" @refresh="refresh" />

    <!-- Pagination -->
    <div v-if="pagination && pagination.hasMore" class="flex justify-center">
      <Button variant="outline" @click="loadMore" :disabled="loading">
        <ChevronDown class="h-4 w-4 mr-2" />
        Load More
      </Button>
    </div>

    <!-- Create Upload Dialog -->
    <Dialog v-model:open="showCreateUpload">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Upload</DialogTitle>
          <DialogDescription>Upload files for translation</DialogDescription>
        </DialogHeader>
        <div class="py-4">
          <p class="text-muted-foreground">
            This will integrate the existing upload forms (ContentUpload, GlobalUpload, PageUpload).
          </p>
          <p class="text-sm text-muted-foreground mt-2">
            For now, use the original upload interface or we'll integrate it here.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateUpload = false">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUploads } from '@/composables'
import { RefreshCw, Plus, AlertCircle, UploadCloud, ChevronDown } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import UploadsList from './uploads/UploadsList.vue'

const { uploads, pagination, loading, error, fetchUploads } = useUploads()

const showCreateUpload = ref(false)
let currentOffset = 0

onMounted(() => {
  fetchUploads({ limit: 50, offset: 0 })
})

const refresh = () => {
  currentOffset = 0
  fetchUploads({ limit: 50, offset: 0 })
}

const loadMore = () => {
  currentOffset += 50
  fetchUploads({ limit: 50, offset: currentOffset })
}
</script>
