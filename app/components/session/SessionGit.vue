<template>
  <div class="border border-gray-700">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
      <span class="text-xs uppercase tracking-wider text-gray-400">Git Job</span>
      <button
        @click="trigger"
        :disabled="triggering"
        class="text-xs px-3 py-1 border border-gray-600 text-gray-300 hover:text-white hover:border-white uppercase tracking-wider disabled:opacity-50"
      >{{ triggering ? 'Triggering...' : 'Trigger Git' }}</button>
    </div>

    <div v-if="!gitJob && !triggerResult" class="px-4 py-6 text-sm text-gray-600">
      No git job yet. Use "Trigger Git" to create a PR/branch for this session.
    </div>
    <div v-else-if="gitJob" class="p-4 space-y-2 text-sm">
      <div class="flex gap-6 flex-wrap">
        <span><span class="text-gray-500 text-xs uppercase">Status</span><br><StatusBadge :status="gitJob.status" /></span>
        <span><span class="text-gray-500 text-xs uppercase">Forge</span><br><span class="text-gray-300 uppercase">{{ gitJob.forge }}</span></span>
        <span v-if="gitJob.branch"><span class="text-gray-500 text-xs uppercase">Branch</span><br><span class="text-gray-300 font-mono text-xs">{{ gitJob.branch }}</span></span>
        <span v-if="gitJob.prNumber"><span class="text-gray-500 text-xs uppercase">PR #</span><br><span class="text-gray-300">{{ gitJob.prNumber }}</span></span>
      </div>
      <div v-if="gitJob.prUrl" class="text-xs">
        <a :href="gitJob.prUrl" target="_blank" class="text-accent hover:underline">{{ gitJob.prUrl }}</a>
      </div>
      <div v-if="gitJob.error" class="text-error text-xs mt-2">{{ gitJob.error }}</div>
    </div>

    <div v-if="triggerError" class="px-4 pb-4 text-error text-xs">{{ triggerError }}</div>
    <div v-if="triggerResult" class="px-4 pb-4 text-success text-xs">Git job enqueued (ID: {{ triggerResult.jobId }})</div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  sessionId: string
  gitJob: {
    id: string
    forge: string
    status: string
    branch?: string | null
    prNumber?: number | null
    prUrl?: string | null
    error?: string | null
  } | null
}>()

const triggering = ref(false)
const triggerError = ref<string | null>(null)
const triggerResult = ref<{ jobId: string } | null>(null)

async function trigger() {
  triggering.value = true
  triggerError.value = null
  triggerResult.value = null
  try {
    triggerResult.value = await $fetch<{ jobId: string }>(`/api/git/${props.sessionId}/trigger` as string, { method: 'POST' })
  } catch (e: any) {
    triggerError.value = e?.data?.statusMessage ?? 'Trigger failed'
  } finally {
    triggering.value = false
  }
}
</script>
