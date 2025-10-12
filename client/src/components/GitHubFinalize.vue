<template>
  <Card class="mb-6">
    <CardHeader>
      <CardTitle>🔀 GitHub Finalize</CardTitle>
      <CardDescription>Create a pull request with your translations</CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="finalize" class="space-y-4">
        <div class="space-y-2">
          <Label for="finalizeSenderId">Sender ID</Label>
          <Input 
            id="finalizeSenderId" 
            v-model="senderId" 
            type="text" 
            required 
            placeholder="e.g., my-project-123"
          />
        </div>

        <div class="space-y-2">
          <Label for="repoOwner">Repository Owner</Label>
          <Input 
            id="repoOwner" 
            v-model="repoOwner" 
            type="text" 
            required 
            placeholder="e.g., CalmProton"
          />
        </div>

        <div class="space-y-2">
          <Label for="repoName">Repository Name</Label>
          <Input 
            id="repoName" 
            v-model="repoName" 
            type="text" 
            required 
            placeholder="e.g., my-repo"
          />
        </div>

        <div class="space-y-2">
          <Label for="baseBranch">Base Branch (optional)</Label>
          <Input 
            id="baseBranch" 
            v-model="baseBranch" 
            type="text" 
            placeholder="e.g., main (default)"
          />
        </div>

        <Button type="submit" :disabled="loading" class="w-full">
          {{ loading ? 'Finalizing...' : 'Create Pull Request' }}
        </Button>
      </form>

      <Alert v-if="response" class="mt-4">
        <AlertTitle>✅ Pull Request Created</AlertTitle>
        <AlertDescription>
          <pre class="mt-2 text-xs overflow-x-auto">{{ JSON.stringify(response, null, 2) }}</pre>
          <div v-if="response.pullRequestUrl" class="mt-3">
            <a 
              :href="response.pullRequestUrl" 
              target="_blank" 
              class="text-primary hover:underline font-medium"
            >
              Open Pull Request →
            </a>
          </div>
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const senderId = ref('')
const repoOwner = ref('')
const repoName = ref('')
const baseBranch = ref('')
const loading = ref(false)
const response = ref<any>(null)
const error = ref('')

const finalize = async () => {
  loading.value = true
  error.value = ''
  response.value = null

  try {
    const formData = new FormData()
    formData.append('senderId', senderId.value)
    formData.append('repoOwner', repoOwner.value)
    formData.append('repoName', repoName.value)
    if (baseBranch.value) {
      formData.append('baseBranch', baseBranch.value)
    }

    const res = await fetch('/github/finalize', {
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
</script>
