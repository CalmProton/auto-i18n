<template>
  <div class="grid grid-cols-[1fr_100px_160px_140px_90px] gap-4 px-4 py-3 text-sm">
    <span class="truncate text-gray-300 font-mono text-xs" :title="session.senderId">
      {{ session.senderId }}
    </span>
    <span class="text-gray-500 text-xs uppercase">{{ session.sessionType }}</span>
    <span class="text-gray-400 text-xs truncate">
      {{ session.sourceLocale }} → {{ targetLocalesSummary }}
    </span>
    <span class="text-gray-500 text-xs">{{ relativeTime(session.createdAt) }}</span>
    <StatusBadge :status="session.status" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  session: {
    id: string
    senderId: string
    sessionType: string
    sourceLocale: string
    targetLocales: string
    status: string
    createdAt: string
  }
}>()

const targetLocalesSummary = computed(() => {
  try {
    const arr: string[] = JSON.parse(props.session.targetLocales)
    if (arr.length <= 3) return arr.join(', ')
    return `${arr.slice(0, 2).join(', ')} +${arr.length - 2}`
  } catch {
    return props.session.targetLocales
  }
})

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
</script>
