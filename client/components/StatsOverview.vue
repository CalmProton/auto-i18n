<template>
  <Card>
    <CardContent>
      <div v-if="loading" class="flex items-center justify-center py-8">
        <Spinner class="h-8 w-8" />
      </div>
      
      <div v-else-if="error" class="py-4">
        <Alert variant="destructive">
          <AlertCircle class="h-4 w-4" />
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>
      
      <div v-else class="grid grid-cols-5 md:grid-cols-5 gap-4">
        <!-- Uploads Stat -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Upload class="h-4 w-4" />
            Total Uploads
          </p>
          <p class="text-3xl font-bold text-foreground">{{ stats?.totalUploads ?? 0 }}</p>
        </div>
        
        <!-- Total Translations -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Languages class="h-4 w-4" />
            Total Translations
          </p>
          <p class="text-3xl font-bold text-foreground">{{ stats?.totalTranslations ?? 0 }}</p>
        </div>
        
        <!-- Completed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CheckCircle class="h-4 w-4" />
            Completed Batches
          </p>
          <p class="text-3xl font-bold text-foreground">{{ stats?.completedBatches ?? 0 }}</p>
        </div>
        
        <!-- Failed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <XCircle class="h-4 w-4" />
            Failed Batches
          </p>
          <p class="text-3xl font-bold text-foreground">{{ stats?.failedBatches ?? 0 }}</p>
        </div>
        
        <!-- Ready for PR -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <GitPullRequest class="h-4 w-4" />
            Ready for PR
          </p>
          <p class="text-3xl font-bold text-foreground">{{ stats?.readyForPR ?? 0 }}</p>
        </div>
      </div>
      
      <!-- Refresh Button -->
      <div class="mt-4 flex justify-end">
        <Button variant="outline" size="sm" @click="refresh" :disabled="loading">
          <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSystem } from '@/composables'
import {
  Upload,
  CheckCircle,
  XCircle,
  Languages,
  GitPullRequest,
  RefreshCw,
  AlertCircle
} from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

const { stats, loading, error, fetchStats } = useSystem()

onMounted(() => {
  fetchStats()
})

const refresh = () => {
  fetchStats()
}
</script>
