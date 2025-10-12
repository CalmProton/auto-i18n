<template>
  <Card>
    <CardHeader>
      <CardTitle>Filters</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Status Filter -->
        <div class="space-y-2">
          <Label for="status-filter">Status</Label>
          <select
            id="status-filter"
            :value="statusFilter"
            @change="$emit('update:statusFilter', ($event.target as HTMLSelectElement).value)"
            class="w-full px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="partially_failed">Partially Failed</option>
          </select>
        </div>

        <!-- Sender Filter -->
        <div class="space-y-2">
          <Label for="sender-filter">Sender ID</Label>
          <Input
            id="sender-filter"
            :value="senderFilter"
            @input="$emit('update:senderFilter', ($event.target as HTMLInputElement).value)"
            placeholder="Filter by sender..."
          />
        </div>

        <!-- Clear Filters -->
        <div class="flex items-end">
          <Button
            variant="outline"
            @click="$emit('clearFilters')"
            class="w-full"
          >
            Clear Filters
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { BatchStatus } from '@/types/api'

defineProps<{
  statusFilter: BatchStatus | 'all'
  senderFilter: string
}>()

defineEmits<{
  'update:statusFilter': [value: string]
  'update:senderFilter': [value: string]
  clearFilters: []
}>()
</script>
