<template>
  <Card>
    <CardHeader>
      <CardTitle>System Overview</CardTitle>
      <CardDescription>Real-time statistics across your translation pipeline</CardDescription>
    </CardHeader>
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
      
      <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <!-- Uploads Stat -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Upload class="h-4 w-4" />
            Total Uploads
          </p>
          <p class="text-3xl font-bold">{{ stats?.totalUploads ?? 0 }}</p>
        </div>
        
        <!-- Active Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Timer class="h-4 w-4" />
            Active Batches
          </p>
          <p class="text-3xl font-bold text-blue-600">{{ stats?.activeBatches ?? 0 }}</p>
        </div>
        
        <!-- Completed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CheckCircle class="h-4 w-4" />
            Completed Batches
          </p>
          <p class="text-3xl font-bold text-green-600">{{ stats?.completedBatches ?? 0 }}</p>
        </div>
        
        <!-- Failed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <XCircle class="h-4 w-4" />
            Failed Batches
          </p>
          <p class="text-3xl font-bold text-red-600">{{ stats?.failedBatches ?? 0 }}</p>
        </div>
        
        <!-- Total Translations -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Languages class="h-4 w-4" />
            Total Translations
          </p>
          <p class="text-3xl font-bold">{{ stats?.totalTranslations ?? 0 }}</p>
        </div>
        
        <!-- Pending Translations -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Clock class="h-4 w-4" />
            Pending
          </p>
          <p class="text-3xl font-bold text-orange-600">{{ stats?.pendingTranslations ?? 0 }}</p>
        </div>
        
        <!-- Ready for PR -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <GitPullRequest class="h-4 w-4" />
            Ready for PR
          </p>
          <p class="text-3xl font-bold text-purple-600">{{ stats?.readyForPR ?? 0 }}</p>
        </div>
        
        <!-- System Status -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity class="h-4 w-4" />
            System Status
          </p>
          <Badge variant="default" class="bg-green-600">
            <CircleDot class="h-3 w-3 mr-1" />
            Operational
          </Badge>
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
  Timer,
  CheckCircle,
  XCircle,
  Languages,
  Clock,
  GitPullRequest,
  Activity,
  CircleDot,
  RefreshCw,
  AlertCircle
} from 'lucide-vue-next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
