<template>
  <Card class="mb-6">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Icon icon="mdi:file-document-multiple" :size="24" />
        Upload Content Files
      </CardTitle>
      <CardDescription>Upload markdown content files for translation</CardDescription>
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
          <Label for="folder">Folder Name</Label>
          <Input 
            id="folder" 
            v-model="folderName" 
            type="text" 
            required 
            placeholder="e.g., blog"
          />
        </div>

        <div class="space-y-2">
          <Label for="files">Select Content Files (.md)</Label>
          <Input 
            id="files" 
            type="file" 
            multiple 
            accept=".md,.markdown" 
            @change="handleFileChange"
          />
          <p v-if="selectedFiles.length > 0" class="text-sm text-muted-foreground">
            Selected: {{ selectedFiles.length }} file(s)
          </p>
        </div>

        <Button type="submit" :disabled="loading || selectedFiles.length === 0" class="w-full">
          {{ loading ? 'Uploading...' : 'Upload Content' }}
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
      <CardDescription>Start the translation process for uploaded files</CardDescription>
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
const folderName = ref('')
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
    formData.append('folderName', folderName.value)
    
    selectedFiles.value.forEach(file => {
      formData.append(`content_${locale.value}_${folderName.value}`, file)
    })

    const res = await fetch('/translate/content', {
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

    const res = await fetch('/translate/content/trigger', {
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
