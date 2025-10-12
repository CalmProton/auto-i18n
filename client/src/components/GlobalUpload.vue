<template>
  <Card class="mb-6">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Icon icon="mdi:web" :size="24" />
        Upload Global Translation
      </CardTitle>
      <CardDescription>Upload a global JSON translation file</CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="handleUpload" class="space-y-4">
        <div class="space-y-2">
          <Label for="senderId">Sender ID</Label>
          <Input 
            id="senderId" 
            v-model="senderId" 
            type="text" 
            required 
            placeholder="e.g., my-project-123"
          />
        </div>

        <div class="space-y-2">
          <Label for="locale">Source Locale</Label>
          <Input 
            id="locale" 
            v-model="locale" 
            type="text" 
            required 
            placeholder="e.g., en"
          />
        </div>

        <div class="space-y-2">
          <Label for="file">Select Global JSON File</Label>
          <Input 
            id="file" 
            type="file" 
            accept=".json" 
            @change="handleFileChange"
          />
        </div>

        <Button type="submit" :disabled="loading || !selectedFile" class="w-full">
          {{ loading ? 'Uploading...' : 'Upload Global' }}
        </Button>
      </form>

      <Alert v-if="response" class="mt-4">
        <AlertTitle class="flex items-center gap-2">
          <Icon icon="mdi:check-circle" :size="20" color="#22c55e" />
          Upload Successful
        </AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ JSON.stringify(response, null, 2) }}</pre>
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
    </CardContent>
  </Card>

  <Card v-if="response" class="mb-6">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Icon icon="mdi:rocket-launch" :size="24" />
        Trigger Translation
      </CardTitle>
      <CardDescription>Start the translation process</CardDescription>
    </CardHeader>
    <CardContent>
      <Button @click="triggerTranslation" :disabled="loading" class="w-full">
        {{ loading ? 'Triggering...' : 'Start Translation' }}
      </Button>
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
const locale = ref('en')
const selectedFile = ref<File | null>(null)
const loading = ref(false)
const response = ref<any>(null)
const error = ref('')

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  selectedFile.value = target.files?.[0] || null
}

const handleUpload = async () => {
  if (!selectedFile.value) return

  loading.value = true
  error.value = ''
  response.value = null

  try {
    const formData = new FormData()
    formData.append('senderId', senderId.value)
    formData.append('locale', locale.value)
    formData.append(`global_${locale.value}`, selectedFile.value)

    const res = await fetch('/translate/global', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }

    response.value = await res.json()
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const triggerTranslation = async () => {
  loading.value = true
  error.value = ''

  try {
    const formData = new FormData()
    formData.append('senderId', senderId.value)

    const res = await fetch('/translate/global/trigger', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }

    const result = await res.json()
    response.value = { ...response.value, translation: result }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>
