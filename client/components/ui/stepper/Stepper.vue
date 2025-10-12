<script setup lang="ts">
import { computed } from 'vue'
import { Check, Loader2, XCircle } from 'lucide-vue-next'

export interface Step {
  id: string
  label: string
  description?: string
  completed: boolean
  active: boolean
  error?: string
  timestamp?: string
}

interface Props {
  steps: Step[]
  orientation?: 'horizontal' | 'vertical'
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'horizontal'
})

const isVertical = computed(() => props.orientation === 'vertical')
</script>

<template>
  <div :class="[
    'flex',
    isVertical ? 'flex-col space-y-4' : 'flex-row items-start justify-between'
  ]">
    <div
      v-for="(step, index) in steps"
      :key="step.id"
      :class="[
        'flex',
        isVertical ? 'flex-row items-start' : 'flex-col items-center',
        'relative',
        { 'flex-1': !isVertical && index < steps.length - 1 }
      ]"
    >
      <!-- Step indicator -->
      <div :class="[
        'flex items-center justify-center rounded-full border-2 transition-all',
        isVertical ? 'w-10 h-10 flex-shrink-0' : 'w-12 h-12 mb-2',
        step.completed && !step.error
          ? 'bg-primary border-primary text-primary-foreground'
          : step.active
          ? 'border-primary bg-background text-primary'
          : step.error
          ? 'border-destructive bg-background text-destructive'
          : 'border-muted bg-background text-muted-foreground'
      ]">
        <Check v-if="step.completed && !step.error" :class="isVertical ? 'h-5 w-5' : 'h-6 w-6'" />
        <XCircle v-else-if="step.error" :class="isVertical ? 'h-5 w-5' : 'h-6 w-6'" />
        <Loader2 v-else-if="step.active" :class="['animate-spin', isVertical ? 'h-5 w-5' : 'h-6 w-6']" />
        <span v-else class="text-sm font-medium">{{ index + 1 }}</span>
      </div>

      <!-- Step content -->
      <div :class="[
        'flex flex-col',
        isVertical ? 'ml-4 flex-1' : 'text-center'
      ]">
        <div :class="[
          'font-medium transition-colors',
          step.completed || step.active ? 'text-foreground' : 'text-muted-foreground',
          isVertical ? 'text-sm' : 'text-xs'
        ]">
          {{ step.label }}
        </div>
        
        <div v-if="step.description" :class="[
          'text-muted-foreground transition-colors mt-0.5',
          isVertical ? 'text-xs' : 'text-[10px]'
        ]">
          {{ step.description }}
        </div>

        <div v-if="step.error" class="text-destructive text-xs mt-1">
          {{ step.error }}
        </div>

        <div v-if="step.timestamp && step.completed" class="text-muted-foreground text-[10px] mt-1">
          {{ new Date(step.timestamp).toLocaleString() }}
        </div>
      </div>

      <!-- Connector line -->
      <div
        v-if="index < steps.length - 1"
        :class="[
          'transition-colors',
          isVertical
            ? 'absolute left-5 top-10 w-0.5 h-full'
            : 'absolute top-6 left-1/2 w-full h-0.5 -translate-y-1/2',
          step.completed ? 'bg-primary' : 'bg-muted'
        ]"
        :style="isVertical ? { height: 'calc(100% + 1rem)' } : {}"
      />
    </div>
  </div>
</template>
