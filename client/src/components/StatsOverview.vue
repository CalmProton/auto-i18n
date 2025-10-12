<template>
  <Card>
    <CardHeader>
      <CardTitle>System Overview</CardTitle>
      <CardDescription>Real-time statistics across your translation pipeline</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="loading" class="flex items-center justify-center py-8">
        <p class="text-muted-foreground">Loading statistics...</p>
      </div>
      
      <div v-else-if="error" class="py-4">
        <Alert variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>
      
      <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <!-- Uploads Stat -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Total Uploads</p>
          <p class="text-3xl font-bold">{{ stats?.totalUploads ?? 0 }}</p>
        </div>
        
        <!-- Active Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Active Batches</p>
          <p class="text-3xl font-bold text-blue-600">{{ stats?.activeBatches ?? 0 }}</p>
        </div>
        
        <!-- Completed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Completed Batches</p>
          <p class="text-3xl font-bold text-green-600">{{ stats?.completedBatches ?? 0 }}</p>
        </div>
        
        <!-- Failed Batches -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Failed Batches</p>
          <p class="text-3xl font-bold text-red-600">{{ stats?.failedBatches ?? 0 }}</p>
        </div>
        
        <!-- Total Translations -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Total Translations</p>
          <p class="text-3xl font-bold">{{ stats?.totalTranslations ?? 0 }}</p>
        </div>
        
        <!-- Pending Translations -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Pending</p>
          <p class="text-3xl font-bold text-orange-600">{{ stats?.pendingTranslations ?? 0 }}</p>
        </div>
        
        <!-- Ready for PR -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">Ready for PR</p>
          <p class="text-3xl font-bold text-purple-600">{{ stats?.readyForPR ?? 0 }}</p>
        </div>
        
        <!-- System Status -->
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-foreground">System Status</p>
          <p class="text-lg font-semibold text-green-600 flex items-center gap-2">
            <Icon icon="mdi:circle" :size="16" color="#22c55e" />
            Operational
          </p>
        </div>
      </div>
      
      <!-- Refresh Button -->
      <div class="mt-4 flex justify-end">
        <Button variant="outline" size="sm" @click="refresh" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSystem } from '@/composables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

const { stats, loading, error, fetchStats } = useSystem()

onMounted(() => {
  fetchStats()
})

const refresh = () => {
  fetchStats()
}
</script>
