<template>
  <div class="border-b border-gray-800">
    <label class="flex items-start gap-0">
      <span class="w-64 shrink-0 px-4 py-3 text-xs text-gray-400 border-r border-gray-800 bg-gray-900 uppercase tracking-wider">
        {{ label }}
      </span>
      <textarea
        v-if="multiline"
        v-model="localValue"
        rows="6"
        class="i18n-input border-0 resize-y text-xs"
        :placeholder="name"
      />
      <input
        v-else
        v-model="localValue"
        :type="sensitive ? 'password' : 'text'"
        class="i18n-input border-0 text-xs"
        :placeholder="name"
        autocomplete="off"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string | undefined
  label: string
  name: string
  sensitive?: boolean
  multiline?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const localValue = computed({
  get: () => props.modelValue ?? '',
  set: (v) => emit('update:modelValue', v),
})
</script>
