<template>
  <div class="min-h-screen bg-background">
    <div class="container mx-auto p-6 max-w-7xl">
      <div class="mb-8">
        <h1 class="text-4xl font-bold mb-2">🌍 Auto-i18n Client</h1>
        <p class="text-muted-foreground">Upload, translate, and sync your content across languages</p>
      </div>
      
      <Card class="mb-6">
        <CardHeader>
          <CardTitle>Translation Type</CardTitle>
          <CardDescription>Select the type of files you want to translate</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs v-model="translationType" class="w-full">
            <TabsList class="grid w-full grid-cols-3">
              <TabsTrigger value="content">Content Files</TabsTrigger>
              <TabsTrigger value="global">Global Translation</TabsTrigger>
              <TabsTrigger value="page">Page Translation</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <ContentUpload v-if="translationType === 'content'" />
      <GlobalUpload v-if="translationType === 'global'" />
      <PageUpload v-if="translationType === 'page'" />
      
      <BatchStatus />
      <GitHubFinalize />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ContentUpload from './components/ContentUpload.vue'
import GlobalUpload from './components/GlobalUpload.vue'
import PageUpload from './components/PageUpload.vue'
import BatchStatus from './components/BatchStatus.vue'
import GitHubFinalize from './components/GitHubFinalize.vue'

const translationType = ref<'content' | 'global' | 'page'>('content')
</script>
