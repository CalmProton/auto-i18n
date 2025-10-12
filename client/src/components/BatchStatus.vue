<template>
  <Card class="mb-6">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Icon icon="mdi:chart-box" :size="24" />
        Batch Status & Processing
      </CardTitle>
      <CardDescription>Check the status of your translation batches</CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="checkStatus" class="space-y-4">
        <div class="space-y-2">
          <Label for="statusSenderId">Sender ID</Label>
          <Input 
            id="statusSenderId" 
            v-model="senderId" 
            type="text" 
            required 
            placeholder="e.g., my-project-123"
          />
        </div>

        <Button type="submit" :disabled="loading" class="w-full">
          {{ loading ? 'Checking...' : 'Check Batch Status' }}
        </Button>
      </form>

      <Alert v-if="status" class="mt-4">
        <AlertTitle class="flex items-center gap-2">
          <Icon icon="mdi:clipboard-list" :size="20" />
          Batch Status
        </AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ JSON.stringify(status, null, 2) }}</pre>
        </AlertDescription>
      </Alert>

      <Alert v-if="error" variant="destructive" class="mt-4">
        <AlertTitle class="flex items-center gap-2">
          <Icon icon="mdi:close-circle" :size="20" />
          Error
        </AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ error }}</pre>
        </AlertDescription>
      </Alert>

      <div v-if="status" class="mt-6">
        <h3 class="text-lg font-semibold mb-3">Process Batch Output</h3>
        <Button @click="processBatch" :disabled="loading" class="w-full">
          {{ loading ? 'Processing...' : 'Process Batch Results' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import Icon from './Icon.vue'

const senderId = ref('')
const loading = ref(false)
const status = ref<any>(null)
const error = ref('')

const checkStatus = async () => {
  loading.value = true
  error.value = ''
  status.value = null

  try {
    const res = await fetch(`/translate/batch/status?senderId=${senderId.value}`)

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }

    status.value = await res.json()
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const processBatch = async () => {
  loading.value = true
  error.value = ''

  try {
    const formData = new FormData()
    formData.append('senderId', senderId.value)

    const res = await fetch('/translate/batch/process', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }

    const result = await res.json()
    status.value = { ...status.value, processed: result }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>
