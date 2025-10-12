<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold mb-1">Existing Pull Requests</h3>
      <p class="text-sm text-muted-foreground">
        {{ sessions.length }} session{{ sessions.length !== 1 ? 's' : '' }} with active PRs
      </p>
    </div>

    <div class="space-y-3">
      <Card
        v-for="session in sessions"
        :key="session.senderId"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <CardTitle class="text-base">{{ session.senderId }}</CardTitle>
              <CardDescription class="mt-1">
                <div class="flex items-center gap-3 text-xs">
                  <span class="flex items-center gap-1">
                    <Icon icon="mdi:source-repository" :size="14" />
                    {{ session.repository.owner }}/{{ session.repository.name }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="mdi:source-branch" :size="14" />
                    {{ session.repository.baseBranch }}
                  </span>
                </div>
              </CardDescription>
            </div>
            <div class="flex items-center gap-2">
              <a
                v-if="session.pullRequestUrl"
                :href="session.pullRequestUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <Button variant="outline" size="sm">
                  View PR #{{ session.pullRequestNumber }}
                  <span class="ml-1">↗</span>
                </Button>
              </a>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div class="grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <div class="font-semibold text-green-600">
                {{ session.completedLocales.length }}
              </div>
              <div class="text-xs text-muted-foreground">Locales</div>
            </div>
            <div>
              <div class="font-semibold">
                {{ session.fileCount.content + session.fileCount.global + session.fileCount.page }}
              </div>
              <div class="text-xs text-muted-foreground">Files</div>
            </div>
            <div>
              <div class="font-semibold text-blue-600">
                #{{ session.pullRequestNumber }}
              </div>
              <div class="text-xs text-muted-foreground">PR Number</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitHubSession } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Icon from '../Icon.vue'

defineProps<{
  sessions: GitHubSession[]
}>()
</script>
