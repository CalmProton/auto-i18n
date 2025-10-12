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
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
        <Button @click="showCreateUpload = true">
          + New Upload
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !uploads.length" class="flex items-center justify-center py-12">
      <div class="text-center space-y-2">
        <p class="text-lg font-medium">Loading uploads...</p>
        <p class="text-sm text-muted-foreground">Please wait</p>
      </div>
    </div>

    <!-- Error State -->
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Empty State -->
    <div v-else-if="!uploads.length" class="flex items-center justify-center py-12 border-2 border-dashed rounded-lg">
      <div class="text-center space-y-2">
        <p class="text-lg font-medium">No uploads yet</p>
        <p class="text-sm text-muted-foreground">Create your first upload session to get started</p>
        <Button @click="showCreateUpload = true" class="mt-4">
          + Create Upload
        </Button>
      </div>
    </div>

    <!-- Uploads List -->
    <UploadsList v-else :uploads="uploads" @refresh="refresh" />

    <!-- Pagination -->
    <div v-if="pagination && pagination.hasMore" class="flex justify-center">
      <Button variant="outline" @click="loadMore" :disabled="loading">
        Load More
      </Button>
    </div>

    <!-- Create Upload Dialog (placeholder for now) -->
    <div v-if="showCreateUpload" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showCreateUpload = false">
      <Card class="w-full max-w-2xl m-4">
        <CardHeader>
          <CardTitle>Create New Upload</CardTitle>
          <CardDescription>Upload files for translation</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-muted-foreground">
            This will integrate the existing upload forms (ContentUpload, GlobalUpload, PageUpload).
          </p>
          <p class="text-sm text-muted-foreground mt-2">
            For now, use the original upload interface or we'll integrate it here.
          </p>
        </CardContent>
        <div class="px-6 pb-6">
          <Button @click="showCreateUpload = false" class="w-full">
            Close
          </Button>
        </div>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUploads } from '@/composables'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
