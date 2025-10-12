<template>
  <div v-if="!isAuthenticated" class="min-h-screen bg-background flex items-center justify-center p-6">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Lock class="h-6 w-6" />
          Authentication Required
        </CardTitle>
        <CardDescription>
          {{ authRequired ? 'Enter your access key to continue' : 'Checking authentication...' }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleLogin" class="space-y-4">
          <div class="space-y-2">
            <Label for="access-key">Access Key</Label>
            <Input
              id="access-key"
              v-model="accessKey"
              type="password"
              placeholder="Enter your access key"
              :disabled="isValidating"
            />
          </div>
          
          <Alert v-if="error" variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
          
          <Button type="submit" class="w-full" :disabled="isValidating || !accessKey">
            <Loader2 v-if="isValidating" class="h-4 w-4 mr-2 animate-spin" />
            {{ isValidating ? 'Validating...' : 'Login' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
  
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables'
import { Lock, AlertCircle, Loader2 } from 'lucide-vue-next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

const { isAuthenticated, authRequired, isValidating, error, login, initialize } = useAuth()

const accessKey = ref('')

onMounted(async () => {
  await initialize()
})

const handleLogin = async () => {
  if (!accessKey.value) return
  await login(accessKey.value)
  if (isAuthenticated.value) {
    accessKey.value = ''
  }
}
</script>
