<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <div class="border-b">
      <div class="container mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold">🌍 Auto-i18n Dashboard</h1>
            <p class="text-sm text-muted-foreground mt-1">
              Manage your translation pipeline from upload to PR
            </p>
          </div>
          
          <div class="flex items-center gap-4">
            <!-- Theme toggle placeholder - can be added later -->
            <Button variant="outline" size="sm" @click="handleLogout" v-if="isAuthenticated">
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Stats Overview -->
    <div class="container mx-auto px-6 py-6">
      <StatsOverview />
    </div>
    
    <!-- Tabs Navigation -->
    <div class="container mx-auto px-6">
      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full grid-cols-4">
          <TabsTrigger value="uploads">
            📦 Uploads
          </TabsTrigger>
          <TabsTrigger value="batches">
            🔄 Batches
          </TabsTrigger>
          <TabsTrigger value="translations">
            🌐 Translations
          </TabsTrigger>
          <TabsTrigger value="github">
            🔀 GitHub
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    
    <!-- Tab Content -->
    <div class="container mx-auto px-6 py-6">
      <KeepAlive>
        <component :is="currentTabComponent" />
      </KeepAlive>
    </div>
    
    <!-- Toast Notifications -->
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuth } from '@/composables'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import StatsOverview from './StatsOverview.vue'
import UploadsTab from './UploadsTab.vue'
import BatchesTab from './BatchesTab.vue'
import TranslationsTab from './TranslationsTab.vue'
import GitHubTab from './GitHubTab.vue'
import ToastContainer from './ToastContainer.vue'
// import TranslationsTab from './TranslationsTab.vue'
// import GitHubTab from './GitHubTab.vue'

const { isAuthenticated, logout } = useAuth()
const activeTab = ref('uploads')

const currentTabComponent = computed(() => {
  switch (activeTab.value) {
    case 'uploads':
      return UploadsTab
    case 'batches':
      return BatchesTab
    case 'translations':
      return TranslationsTab
    case 'github':
      return GitHubTab
    default:
      return UploadsTab
  }
})

const handleLogout = () => {
  if (confirm('Are you sure you want to logout?')) {
    logout()
  }
}
</script>
