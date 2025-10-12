<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold">Translation Results</h2>
        <p class="text-sm text-muted-foreground mt-1">
          View and manage translated content across all locales
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" @click="refresh" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !translations.length" class="flex items-center justify-center py-12">
      <div class="text-center space-y-2">
        <p class="text-lg font-medium">Loading translations...</p>
        <p class="text-sm text-muted-foreground">Please wait</p>
      </div>
    </div>

    <!-- Error State -->
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Empty State -->
    <div v-else-if="!translations.length" class="flex items-center justify-center py-12 border-2 border-dashed rounded-lg">
      <div class="text-center space-y-2">
        <p class="text-lg font-medium">No translations yet</p>
        <p class="text-sm text-muted-foreground">
          Translations will appear here after batch processing
        </p>
      </div>
    </div>

    <!-- Translations List -->
    <TranslationsList v-else :translations="translations" @refresh="refresh" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useTranslations } from '@/composables'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import TranslationsList from './translations/TranslationsList.vue'

const { translations, loading, error, fetchTranslations } = useTranslations()

onMounted(() => {
  fetchTranslations()
})

function refresh() {
  fetchTranslations()
}
</script>
