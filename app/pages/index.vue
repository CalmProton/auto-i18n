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
      <nav class="flex">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="px-5 py-2 text-xs uppercase tracking-widest border border-b-0 transition-colors"
          :class="activeTab === tab.id
            ? 'bg-white text-black border-white'
            : 'bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-400'"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <!-- Content -->
    <main class="px-6 py-6">
      <OverviewTab v-if="activeTab === 'overview'" />
      <SessionsTab v-if="activeTab === 'sessions'" />
      <SettingsTab v-if="activeTab === 'settings'" />
    </main>
  </div>
</template>

<script setup lang="ts">
const activeTab = ref('overview')

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'settings', label: 'Settings' },
]

const { data: authStatus } = await useFetch('/api/auth/status')

useHead({ title: 'auto-i18n' })
</script>
