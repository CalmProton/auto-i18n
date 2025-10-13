<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <div class="border-b">
      <div class="container mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <Languages class="h-8 w-8 text-primary" />
            <div>
              <h1 class="text-3xl font-bold">Auto-i18n Dashboard</h1>
              <p class="text-sm text-muted-foreground mt-1">
                Manage your translation pipeline from upload to PR
              </p>
            </div>
          </div>
          
          <div class="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  @click="showHelp"
                >
                  <Keyboard class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Keyboard shortcuts <Kbd>?</Kbd></p>
              </TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" @click="handleLogout" v-if="isAuthenticated">
              <LogOut class="h-4 w-4 mr-2" />
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
        <TabsList class="grid w-full grid-cols-5">
          <TabsTrigger value="uploads" class="flex items-center gap-2">
            <Upload class="h-4 w-4" />
            <span>Uploads</span>
          </TabsTrigger>
          <TabsTrigger value="batches" class="flex items-center gap-2">
            <Timer class="h-4 w-4" />
            <span>Batches</span>
          </TabsTrigger>
          <TabsTrigger value="changes" class="flex items-center gap-2">
            <GitBranch class="h-4 w-4" />
            <span>Changes</span>
          </TabsTrigger>
          <TabsTrigger value="translations" class="flex items-center gap-2">
            <Languages class="h-4 w-4" />
            <span>Translations</span>
          </TabsTrigger>
          <TabsTrigger value="github" class="flex items-center gap-2">
            <Github class="h-4 w-4" />
            <span>GitHub</span>
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
    
    <!-- Keyboard Shortcuts Help -->
    <KeyboardShortcutsHelp ref="helpModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuth, useKeyboardShortcuts } from '@/composables'
import { Languages, Upload, Timer, Github, Keyboard, LogOut, GitBranch } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import StatsOverview from './StatsOverview.vue'
import UploadsTab from './UploadsTab.vue'
import BatchesTab from './BatchesTab.vue'
import TranslationsTab from './TranslationsTab.vue'
import GitHubTab from './GitHubTab.vue'
import ChangesTab from './ChangesTab.vue'
import ToastContainer from './ToastContainer.vue'
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.vue'

const { isAuthenticated, logout } = useAuth()
const activeTab = ref('uploads')
const helpModal = ref<InstanceType<typeof KeyboardShortcutsHelp> | null>(null)

// Valid tab names
const validTabs = ['uploads', 'batches', 'changes', 'translations', 'github'] as const
type TabName = typeof validTabs[number]

// Initialize tab from URL on mount
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const tabFromUrl = params.get('tab')
  if (tabFromUrl && validTabs.includes(tabFromUrl as TabName)) {
    activeTab.value = tabFromUrl
  }
})

// Update URL when tab changes
watch(activeTab, (newTab) => {
  const url = new URL(window.location.href)
  url.searchParams.set('tab', newTab)
  window.history.pushState({}, '', url.toString())
})

// Listen to browser back/forward buttons
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search)
  const tabFromUrl = params.get('tab')
  if (tabFromUrl && validTabs.includes(tabFromUrl as TabName)) {
    activeTab.value = tabFromUrl
  } else {
    activeTab.value = 'uploads'
  }
})

function showHelp() {
  helpModal.value?.open()
}

// Keyboard shortcuts for tab navigation
useKeyboardShortcuts([
  {
    key: '1',
    alt: true,
    description: 'Go to Uploads tab',
    handler: () => activeTab.value = 'uploads'
  },
  {
    key: '2',
    alt: true,
    description: 'Go to Batches tab',
    handler: () => activeTab.value = 'batches'
  },
  {
    key: '3',
    alt: true,
    description: 'Go to Changes tab',
    handler: () => activeTab.value = 'changes'
  },
  {
    key: '4',
    alt: true,
    description: 'Go to Translations tab',
    handler: () => activeTab.value = 'translations'
  },
  {
    key: '5',
    alt: true,
    description: 'Go to GitHub tab',
    handler: () => activeTab.value = 'github'
  }
])

const currentTabComponent = computed(() => {
  switch (activeTab.value) {
    case 'uploads':
      return UploadsTab
    case 'batches':
      return BatchesTab
    case 'changes':
      return ChangesTab
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
