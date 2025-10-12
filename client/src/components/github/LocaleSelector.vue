<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium">Select Locales for PR</label>
      <div class="flex gap-2">
        <Button
          @click="selectAll"
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
        >
          Select All
        </Button>
        <Button
          @click="selectNone"
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
        >
          Clear
        </Button>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-2">
      <label
        v-for="locale in availableLocales"
        :key="locale"
        class="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-muted/50 transition-colors"
        :class="{
          'bg-blue-50 dark:bg-blue-950 border-blue-500': isSelected(locale),
          'bg-background': !isSelected(locale)
        }"
      >
        <input
          type="checkbox"
          :value="locale"
          :checked="isSelected(locale)"
          @change="toggleLocale(locale)"
          class="cursor-pointer"
        />
        <span class="text-sm font-medium">{{ locale }}</span>
        <span v-if="locale === sourceLocale" class="ml-auto text-xs text-blue-600">src</span>
      </label>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ modelValue.length }} locale{{ modelValue.length !== 1 ? 's' : '' }} selected
    </p>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'

const props = defineProps<{
  modelValue: string[]
  availableLocales: string[]
  sourceLocale: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

function isSelected(locale: string): boolean {
  return props.modelValue.includes(locale)
}

function toggleLocale(locale: string) {
  const current = [...props.modelValue]
  const index = current.indexOf(locale)
  
  if (index === -1) {
    current.push(locale)
  } else {
    current.splice(index, 1)
  }
  
  emit('update:modelValue', current)
}

function selectAll() {
  emit('update:modelValue', [...props.availableLocales])
}

function selectNone() {
  emit('update:modelValue', [])
}
</script>
