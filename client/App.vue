<template>
  <TooltipProvider>
    <AuthGuard>
      <DashboardLayout />
    </AuthGuard>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@client/components/ui/tooltip'
import AuthGuard from '@client/components/AuthGuard.vue'
import DashboardLayout from '@client/components/DashboardLayout.vue'
</script>
