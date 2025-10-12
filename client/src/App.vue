<template>
  <TooltipProvider>
    <AuthGuard>
      <DashboardLayout />
    </AuthGuard>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@/components/ui/tooltip'
import AuthGuard from './components/AuthGuard.vue'
import DashboardLayout from './components/DashboardLayout.vue'
</script>
