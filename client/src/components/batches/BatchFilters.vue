<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Filter class="h-4 w-4" />
        Filters
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Status Filter -->
        <div class="space-y-2">
          <Label for="status-filter">Status</Label>
          <Select :model-value="statusFilter" @update:model-value="(val) => $emit('update:statusFilter', val as string)">
            <SelectTrigger id="status-filter">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectSeparator />
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="partially_failed">Partially Failed</SelectItem>
            </SelectContent>
          </Select>
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
            <X class="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Filter, X } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
