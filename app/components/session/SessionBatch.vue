<template>
  <div class="border border-gray-700">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
      <span class="text-xs uppercase tracking-wider text-gray-400">Batch Job</span>
      <button
        v-if="batch?.status === 'pending'"
        @click="submitBatch"
        :disabled="submitting"
        class="text-xs px-3 py-1 border border-gray-600 text-gray-300 hover:text-white hover:border-white uppercase tracking-wider disabled:opacity-50"
      >{{ submitting ? 'Submitting...' : 'Submit Batch' }}</button>
    </div>

    <div v-if="!batch" class="px-4 py-6 text-sm text-gray-600">No batch job for this session.</div>
    <div v-else class="p-4 space-y-2 text-sm">
      <div class="flex gap-6">
        <span><span class="text-gray-500 text-xs uppercase">Status</span><br><StatusBadge :status="batch.status" /></span>
        <span><span class="text-gray-500 text-xs uppercase">Provider</span><br><span class="text-gray-300">{{ batch.provider }}</span></span>
        <span><span class="text-gray-500 text-xs uppercase">Requests</span><br><span class="text-gray-300">{{ batch.totalRequests }}</span></span>
        <span><span class="text-gray-500 text-xs uppercase">Completed</span><br><span class="text-success">{{ batch.completed }}</span></span>
        <span><span class="text-gray-500 text-xs uppercase">Failed</span><br><span class="text-error">{{ batch.failed }}</span></span>
      </div>
      <div v-if="batch.externalBatchId" class="text-xs text-gray-500">
        External ID: <span class="text-gray-300 font-mono">{{ batch.externalBatchId }}</span>
      </div>
      <div v-if="submitError" class="text-error text-xs mt-2">{{ submitError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  sessionId: string
  batch: { id: string; status: string; provider: string; totalRequests: number; completed: number; failed: number; externalBatchId?: string | null } | null
}>()

const submitting = ref(false)
const submitError = ref<string | null>(null)

async function submitBatch() {
  submitting.value = true
  submitError.value = null
  try {
    await $fetch(`/api/batch/${props.sessionId}/submit`, { method: 'POST' })
  } catch (e: any) {
    submitError.value = e?.data?.statusMessage ?? 'Submit failed'
  } finally {
    submitting.value = false
  }
}
</script>
