<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <Label for="pr-title">Pull Request Title</Label>
      <Input
        id="pr-title"
        :model-value="title"
        @update:model-value="(value) => $emit('update:title', String(value))"
        placeholder="Enter PR title..."
        class="w-full"
      />
      <p class="text-xs text-muted-foreground">
        A descriptive title for the pull request
      </p>
    </div>

    <div class="space-y-2">
      <Label for="pr-description">Pull Request Description</Label>
      <textarea
        id="pr-description"
        :value="description"
        @input="$emit('update:description', ($event.target as HTMLTextAreaElement).value)"
        placeholder="Enter PR description..."
        rows="6"
        class="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <p class="text-xs text-muted-foreground">
        Provide details about the translations being added
      </p>
    </div>

    <!-- Preview -->
    <div class="p-3 bg-muted rounded-md">
      <p class="text-xs font-medium mb-2">Preview:</p>
      <div class="text-xs space-y-1">
        <p><strong>Target:</strong> {{ session.repository.owner }}/{{ session.repository.name }}</p>
        <p><strong>Base Branch:</strong> {{ session.repository.baseBranch }}</p>
        <p><strong>Locales:</strong> {{ selectedLocales.join(', ') || 'None selected' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitHubSession } from '@/types/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

defineProps<{
  title: string
  description: string
  session: GitHubSession
  selectedLocales: string[]
}>()

defineEmits<{
  'update:title': [value: string]
  'update:description': [value: string]
}>()
</script>
