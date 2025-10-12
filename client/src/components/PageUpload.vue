<template>
  <Card class="mb-6">
    <CardHeader>
      <CardTitle>📑 Upload Page Files</CardTitle>
      <CardDescription>Upload page-specific JSON translation files</CardDescription>
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
          <Label for="files">Select Page JSON Files</Label>
          <Input 
            id="files" 
            type="file" 
            multiple 
            accept=".json" 
            @change="handleFileChange"
          />
          <p v-if="selectedFiles.length > 0" class="text-sm text-muted-foreground">
            Selected: {{ selectedFiles.length }} file(s)
          </p>
        </div>

        <Button type="submit" :disabled="loading || selectedFiles.length === 0" class="w-full">
          {{ loading ? 'Uploading...' : 'Upload Pages' }}
        </Button>
      </form>

      <Alert v-if="response" class="mt-4">
        <AlertTitle>✅ Upload Successful</AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ JSON.stringify(response, null, 2) }}</pre>
        </AlertDescription>
      </Alert>

      <Alert v-if="error" variant="destructive" class="mt-4">
        <AlertTitle>❌ Error</AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ error }}</pre>
        </AlertDescription>
      </Alert>
    </CardContent>
  </Card>

  <Card v-if="response" class="mb-6">
    <CardHeader>
      <CardTitle>🚀 Trigger Translation</CardTitle>
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

const senderId = ref('')
const locale = ref('en')
const selectedFiles = ref<File[]>([])
const loading = ref(false)
const response = ref<any>(null)
const error = ref('')

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  selectedFiles.value = Array.from(target.files || [])
}

const handleUpload = async () => {
  loading.value = true
  error.value = ''
  response.value = null

  try {
    const formData = new FormData()
    formData.append('senderId', senderId.value)
    formData.append('locale', locale.value)
    
    selectedFiles.value.forEach(file => {
      formData.append(`page_${locale.value}`, file)
    })

    const res = await fetch('/translate/page', {
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

    const res = await fetch('/translate/page/trigger', {
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
