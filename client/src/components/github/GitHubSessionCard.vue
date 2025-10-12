<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <CardTitle class="text-lg">{{ session.senderId }}</CardTitle>
          <CardDescription class="mt-1">
            <div class="flex items-center gap-4 text-xs">
              <span class="flex items-center gap-1">
                <Icon icon="mdi:source-repository" :size="14" />
                {{ session.repository.owner }}/{{ session.repository.name }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="mdi:source-branch" :size="14" />
                {{ session.repository.baseBranch }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="mdi:translate" :size="14" />
                {{ session.sourceLocale }}
              </span>
            </div>
          </CardDescription>
        </div>
        <Button
          @click="isExpanded = !isExpanded"
          variant="ghost"
          size="sm"
        >
          <Icon :icon="isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'" :size="20" />
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Summary Stats -->
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-green-600">
            {{ session.completedLocales.length }}
          </div>
          <div class="text-xs text-muted-foreground">Completed</div>
        </div>
        <div>
          <div class="text-2xl font-bold">
            {{ session.availableLocales.length }}
          </div>
          <div class="text-xs text-muted-foreground">Total Locales</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-blue-600">
            {{ totalFileCount }}
          </div>
          <div class="text-xs text-muted-foreground">Files</div>
        </div>
      </div>

      <!-- PR Creation Form (expandable) -->
      <div v-if="isExpanded" class="pt-4 border-t space-y-4">
        <!-- Locale Selection -->
        <LocaleSelector
          v-model="selectedLocales"
          :available-locales="session.completedLocales"
          :source-locale="session.sourceLocale"
        />

        <!-- PR Metadata -->
        <PRMetadataForm
          v-model:title="prTitle"
          v-model:description="prDescription"
          :session="session"
          :selected-locales="selectedLocales"
        />

        <!-- Create PR Button -->
        <CreatePRButton
          :session="session"
          :selected-locales="selectedLocales"
          :title="prTitle"
          :description="prDescription"
          :disabled="!canCreatePR"
          @create="handleCreatePR"
        />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { GitHubSession } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Icon from '../Icon.vue'
import LocaleSelector from './LocaleSelector.vue'
import PRMetadataForm from './PRMetadataForm.vue'
import CreatePRButton from './CreatePRButton.vue'

const props = defineProps<{
  session: GitHubSession
}>()

const emit = defineEmits<{
  'create-pr': [payload: {
    session: GitHubSession
    locales: string[]
    title: string
    description: string
  }]
  refresh: []
}>()

const isExpanded = ref(false)
const selectedLocales = ref<string[]>([...props.session.completedLocales])

// Generate default PR title and description
const prTitle = ref(`Add translations for ${props.session.completedLocales.join(', ')}`)
const prDescription = ref(
  `This PR adds translations for the following locales:\n\n` +
  props.session.completedLocales.map(locale => `- ${locale}`).join('\n') +
  `\n\n**Source locale:** ${props.session.sourceLocale}\n` +
  `**Repository:** ${props.session.repository.owner}/${props.session.repository.name}\n` +
  `**Base branch:** ${props.session.repository.baseBranch}`
)

const totalFileCount = computed(() => {
  const { content, global, page } = props.session.fileCount
  return content + global + page
})

const canCreatePR = computed(() => {
  return selectedLocales.value.length > 0 && 
         prTitle.value.trim().length > 0 &&
         prDescription.value.trim().length > 0
})

function handleCreatePR() {
  emit('create-pr', {
    session: props.session,
    locales: selectedLocales.value,
    title: prTitle.value,
    description: prDescription.value
  })
}
</script>
