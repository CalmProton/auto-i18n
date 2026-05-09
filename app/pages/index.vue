<template>
  <div class="min-h-screen bg-black text-white font-mono">
    <!-- Header -->
    <header class="border-b border-gray-700 px-6 pt-6">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-bold tracking-widest uppercase">auto-i18n</h1>
        <span class="text-xs uppercase tracking-wider"
          :class="authStatus?.enabled
            ? (authStatus.authenticated ? 'text-success' : 'text-error')
            : 'text-gray-500'">
          {{ authStatus?.enabled ? (authStatus.authenticated ? '● auth ok' : '× unauth') : '○ no auth' }}
        </span>
      </div>

      <!-- Tab bar -->
      <nav class="flex overflow-x-auto">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="px-4 py-2 text-xs uppercase tracking-widest border border-b-0 transition-colors whitespace-nowrap"
          :class="activeTab === tab.id
            ? 'bg-white text-black border-white'
            : 'bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-400'"
          :title="tab.shortcut ? `Shortcut: ${tab.shortcut}` : undefined"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <!-- Content -->
    <main class="px-6 py-6">
      <OverviewTab v-if="activeTab === 'overview'" />
      <SessionsTab v-if="activeTab === 'sessions'" />
      <BatchesTab v-if="activeTab === 'batches'" />
      <TranslationsTab v-if="activeTab === 'translations'" />
      <GitTab v-if="activeTab === 'git'" />
      <SettingsTab v-if="activeTab === 'settings'" />
    </main>
  </div>
</template>

<script setup lang="ts">
const activeTab = ref('overview')

const tabs = [
  { id: 'overview',      label: 'Overview',      shortcut: 'Alt+0' },
  { id: 'sessions',      label: 'Sessions',      shortcut: 'Alt+1' },
  { id: 'batches',       label: 'Batches',       shortcut: 'Alt+2' },
  { id: 'translations',  label: 'Translations',  shortcut: 'Alt+3' },
  { id: 'git',           label: 'Git',           shortcut: 'Alt+4' },
  { id: 'settings',      label: 'Settings',      shortcut: 'Alt+5' },
]

const { data: authStatus } = await useFetch('/api/auth/status')

useHead({ title: 'auto-i18n' })

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  if (!e.altKey) return
  const map: Record<string, string> = {
    '0': 'overview',
    '1': 'sessions',
    '2': 'batches',
    '3': 'translations',
    '4': 'git',
    '5': 'settings',
  }
  const tabId = map[e.key]
  if (tabId) {
    e.preventDefault()
    activeTab.value = tabId
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>
