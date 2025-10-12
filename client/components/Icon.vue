<template>
  <img
    :src="iconUrl"
    :alt="props.icon"
    :width="props.size"
    :height="props.size"
    v-bind="$attrs"
  >
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  icon: string
  color?: string
  size?: number | string
}

const props = withDefaults(defineProps<Props>(), {
  color: '#737373',
  size: 24
})

// Compute the Iconify API URL for the requested icon and color
const iconUrl = computed(() => {
  const encodedColor = encodeURIComponent('#' + props.color.replace(/^#/, ''))
  return `https://api.iconify.design/${props.icon}.svg?color=${encodedColor}`
})
</script>
