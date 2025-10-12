<script setup lang="ts">
import { computed } from 'vue'
import type { ChangeSessionSteps } from '../../types/api'
import { Stepper, type Step } from '../ui/stepper'

interface Props {
  steps: ChangeSessionSteps
  orientation?: 'horizontal' | 'vertical'
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'horizontal'
})

const stepperSteps = computed<Step[]>(() => {
  return [
    {
      id: 'uploaded',
      label: 'Uploaded',
      description: 'Changes received',
      completed: props.steps.uploaded.completed,
      active: !props.steps.uploaded.completed,
      error: props.steps.uploaded.error,
      timestamp: props.steps.uploaded.timestamp
    },
    {
      id: 'batchCreated',
      label: 'Batch Created',
      description: props.steps.batchCreated.batchId 
        ? `Batch ${props.steps.batchCreated.batchId.substring(0, 8)}...` 
        : 'Preparing batch',
      completed: props.steps.batchCreated.completed,
      active: props.steps.uploaded.completed && !props.steps.batchCreated.completed,
      error: props.steps.batchCreated.error,
      timestamp: props.steps.batchCreated.timestamp
    },
    {
      id: 'submitted',
      label: 'Submitted',
      description: props.steps.submitted.openAiBatchId 
        ? 'Submitted to OpenAI' 
        : 'Submitting...',
      completed: props.steps.submitted.completed,
      active: props.steps.batchCreated.completed && !props.steps.submitted.completed,
      error: props.steps.submitted.error,
      timestamp: props.steps.submitted.timestamp
    },
    {
      id: 'processing',
      label: 'Processing',
      description: props.steps.processing.progress 
        ? `${props.steps.processing.progress}% complete` 
        : 'Translating...',
      completed: props.steps.processing.completed,
      active: props.steps.submitted.completed && !props.steps.processing.completed,
      error: props.steps.processing.error,
      timestamp: props.steps.processing.timestamp
    },
    {
      id: 'completed',
      label: 'Completed',
      description: props.steps.completed.translationCount 
        ? `${props.steps.completed.translationCount} translations` 
        : 'Processing output...',
      completed: props.steps.completed.completed,
      active: props.steps.processing.completed && !props.steps.completed.completed,
      error: props.steps.completed.error,
      timestamp: props.steps.completed.timestamp
    },
    {
      id: 'prCreated',
      label: 'PR Created',
      description: props.steps.prCreated.pullRequestNumber 
        ? `PR #${props.steps.prCreated.pullRequestNumber}` 
        : 'Creating PR...',
      completed: props.steps.prCreated.completed,
      active: props.steps.completed.completed && !props.steps.prCreated.completed,
      error: props.steps.prCreated.error,
      timestamp: props.steps.prCreated.timestamp
    }
  ]
})
</script>

<template>
  <Stepper :steps="stepperSteps" :orientation="orientation" />
</template>
