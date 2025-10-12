<template>
  <AuthGuard>
    <DashboardLayout />
  </AuthGuard>
</template>

<script setup lang="ts">
import AuthGuard from './components/AuthGuard.vue'
import DashboardLayout from './components/DashboardLayout.vue'
</script>
