<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useConfig, type TranslationProvider } from '../composables/useConfig'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Separator } from './ui/separator'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { 
  Settings, 
  Key, 
  Cpu, 
  RefreshCw, 
  Save, 
  Eye, 
  EyeOff,
  Check,
  AlertCircle,
  TestTube,
  Loader2,
  ToggleLeft,
  ToggleRight
} from 'lucide-vue-next'

const {
  loading,
  loadingModels,
  status,
  models,
  mockModeEnabled,
  currentProvider,
  configuredProviders,
  fetchConfigs,
  fetchStatus,
  fetchModels,
  toggleMockMode,
  setProvider,
  setProviderApiKey,
  setProviderModel,
} = useConfig()

// Local form state
const localMockMode = ref(false)
const localProvider = ref<TranslationProvider>('openai')
const apiKeys = ref<Record<TranslationProvider, string>>({
  openai: '',
  anthropic: '',
  deepseek: '',
  openrouter: '',
})
const selectedModels = ref<Record<TranslationProvider, string>>({
  openai: '',
  anthropic: '',
  deepseek: '',
  openrouter: '',
})
const showApiKeys = ref<Record<TranslationProvider, boolean>>({
  openai: false,
  anthropic: false,
  deepseek: false,
  openrouter: false,
})

// Saving state per field
const saving = ref<Record<string, boolean>>({})
const saved = ref<Record<string, boolean>>({})

// Initialize from status
watch(status, (newStatus) => {
  if (newStatus) {
    localMockMode.value = newStatus.mockModeEnabled
    if (newStatus.currentProvider) {
      localProvider.value = newStatus.currentProvider
    }
  }
}, { immediate: true })

// Provider info
const providers: Array<{
  id: TranslationProvider
  name: string
  description: string
  hasModelsApi: boolean
}> = [
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, GPT-4 Turbo, GPT-3.5', hasModelsApi: true },
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 3.5 Sonnet, Claude 3 Opus', hasModelsApi: true },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek Chat, DeepSeek Coder', hasModelsApi: false },
  { id: 'openrouter', name: 'OpenRouter', description: 'Access 100+ models through one API', hasModelsApi: true },
]

// Fetch models for a provider when API key changes
async function handleFetchModels(provider: TranslationProvider, apiKey?: string) {
  await fetchModels(provider, apiKey)
}

// Save mock mode
async function saveMockMode() {
  saving.value['mockMode'] = true
  saved.value['mockMode'] = false
  
  const success = await toggleMockMode(localMockMode.value)
  
  saving.value['mockMode'] = false
  if (success) {
    saved.value['mockMode'] = true
    setTimeout(() => saved.value['mockMode'] = false, 2000)
  }
}

// Save provider selection
async function saveProvider() {
  saving.value['provider'] = true
  saved.value['provider'] = false
  
  const success = await setProvider(localProvider.value)
  
  saving.value['provider'] = false
  if (success) {
    saved.value['provider'] = true
    setTimeout(() => saved.value['provider'] = false, 2000)
  }
}

// Save API key for a provider
async function saveApiKey(provider: TranslationProvider) {
  const key = apiKeys.value[provider]
  if (!key.trim()) return
  
  saving.value[`apiKey-${provider}`] = true
  saved.value[`apiKey-${provider}`] = false
  
  const success = await setProviderApiKey(provider, key)
  
  saving.value[`apiKey-${provider}`] = false
  if (success) {
    saved.value[`apiKey-${provider}`] = true
    apiKeys.value[provider] = '' // Clear input after saving
    await fetchStatus() // Refresh status to show key is configured
    await handleFetchModels(provider) // Fetch models with new key
    setTimeout(() => saved.value[`apiKey-${provider}`] = false, 2000)
  }
}

// Save model selection for a provider
async function saveModel(provider: TranslationProvider) {
  const model = selectedModels.value[provider]
  if (!model) return
  
  saving.value[`model-${provider}`] = true
  saved.value[`model-${provider}`] = false
  
  const success = await setProviderModel(provider, model)
  
  saving.value[`model-${provider}`] = false
  if (success) {
    saved.value[`model-${provider}`] = true
    setTimeout(() => saved.value[`model-${provider}`] = false, 2000)
  }
}

// Toggle API key visibility
function toggleKeyVisibility(provider: TranslationProvider) {
  showApiKeys.value[provider] = !showApiKeys.value[provider]
}

// Check if provider is configured
function isProviderConfigured(provider: TranslationProvider): boolean {
  return configuredProviders.value[provider] ?? false
}

// Initialize on mount
onMounted(async () => {
  await fetchStatus()
  await fetchConfigs()
  
  // Fetch models for configured providers
  const providerIds: TranslationProvider[] = ['openai', 'anthropic', 'deepseek', 'openrouter']
  for (const provider of providerIds) {
    if (isProviderConfigured(provider) || provider === 'openrouter') {
      // OpenRouter doesn't require API key for model listing
      await fetchModels(provider)
    }
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Settings class="h-6 w-6" />
          Settings
        </h2>
        <p class="text-muted-foreground mt-1">
          Configure translation providers and AI models
        </p>
      </div>
      <Button variant="outline" size="sm" @click="fetchStatus" :disabled="loading">
        <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
        Refresh
      </Button>
    </div>

    <!-- General Settings -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <TestTube class="h-5 w-5" />
          General Settings
        </CardTitle>
        <CardDescription>
          Global translation settings
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Mock Mode Toggle -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-base">Mock Translations</Label>
            <p class="text-sm text-muted-foreground">
              When enabled, translations return placeholder text instead of calling AI APIs
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              @click="localMockMode = !localMockMode"
              :class="localMockMode ? 'text-green-600 border-green-600' : ''"
            >
              <ToggleRight v-if="localMockMode" class="h-4 w-4 mr-1" />
              <ToggleLeft v-else class="h-4 w-4 mr-1" />
              {{ localMockMode ? 'Enabled' : 'Disabled' }}
            </Button>
            <Button 
              size="sm" 
              @click="saveMockMode"
              :disabled="saving['mockMode'] || localMockMode === mockModeEnabled"
            >
              <Loader2 v-if="saving['mockMode']" class="h-4 w-4 mr-1 animate-spin" />
              <Check v-else-if="saved['mockMode']" class="h-4 w-4 mr-1 text-green-500" />
              <Save v-else class="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Provider Selection -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Cpu class="h-5 w-5" />
          Translation Provider
        </CardTitle>
        <CardDescription>
          Select the default AI provider for translations
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-4">
          <div class="flex-1">
            <Select v-model="localProvider">
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem 
                  v-for="provider in providers" 
                  :key="provider.id" 
                  :value="provider.id"
                >
                  <div class="flex items-center gap-2">
                    <span>{{ provider.name }}</span>
                    <Badge 
                      v-if="isProviderConfigured(provider.id)" 
                      variant="outline" 
                      class="text-green-600 border-green-600"
                    >
                      Configured
                    </Badge>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button 
            @click="saveProvider"
            :disabled="saving['provider'] || localProvider === currentProvider"
          >
            <Loader2 v-if="saving['provider']" class="h-4 w-4 mr-1 animate-spin" />
            <Check v-else-if="saved['provider']" class="h-4 w-4 mr-1 text-green-500" />
            <Save v-else class="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>

        <!-- Current provider info -->
        <div v-if="currentProvider" class="text-sm text-muted-foreground">
          Current provider: <span class="font-medium">{{ currentProvider }}</span>
        </div>
      </CardContent>
    </Card>

    <!-- Provider Configuration Cards -->
    <div class="grid gap-4 md:grid-cols-2">
      <Card v-for="provider in providers" :key="provider.id">
        <CardHeader class="pb-3">
          <CardTitle class="flex items-center justify-between">
            <span class="flex items-center gap-2">
              {{ provider.name }}
              <Badge 
                v-if="isProviderConfigured(provider.id)" 
                variant="outline" 
                class="text-green-600 border-green-600"
              >
                <Check class="h-3 w-3 mr-1" />
                Configured
              </Badge>
              <Badge 
                v-else 
                variant="outline" 
                class="text-yellow-600 border-yellow-600"
              >
                <AlertCircle class="h-3 w-3 mr-1" />
                Not configured
              </Badge>
            </span>
          </CardTitle>
          <CardDescription>{{ provider.description }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- API Key Input -->
          <div class="space-y-2">
            <Label :for="`apiKey-${provider.id}`" class="flex items-center gap-2">
              <Key class="h-4 w-4" />
              API Key
            </Label>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <Input
                  :id="`apiKey-${provider.id}`"
                  :type="showApiKeys[provider.id] ? 'text' : 'password'"
                  v-model="apiKeys[provider.id]"
                  :placeholder="isProviderConfigured(provider.id) ? '••••••••••••' : 'Enter API key'"
                  class="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  @click="toggleKeyVisibility(provider.id)"
                >
                  <EyeOff v-if="showApiKeys[provider.id]" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </Button>
              </div>
              <Button 
                size="sm"
                @click="saveApiKey(provider.id)"
                :disabled="!apiKeys[provider.id].trim() || saving[`apiKey-${provider.id}`]"
              >
                <Loader2 v-if="saving[`apiKey-${provider.id}`]" class="h-4 w-4 mr-1 animate-spin" />
                <Check v-else-if="saved[`apiKey-${provider.id}`]" class="h-4 w-4 mr-1 text-green-500" />
                <Save v-else class="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          </div>

          <Separator />

          <!-- Model Selection -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label :for="`model-${provider.id}`">Model</Label>
              <Button
                v-if="provider.hasModelsApi"
                variant="ghost"
                size="sm"
                @click="handleFetchModels(provider.id)"
                :disabled="loadingModels[provider.id]"
              >
                <RefreshCw 
                  class="h-3 w-3 mr-1" 
                  :class="{ 'animate-spin': loadingModels[provider.id] }" 
                />
                Refresh
              </Button>
            </div>
            
            <div class="flex gap-2">
              <Select v-model="selectedModels[provider.id]" class="flex-1">
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <!-- Show skeleton while loading -->
                  <div v-if="loadingModels[provider.id]" class="p-2">
                    <Skeleton class="h-4 w-full mb-2" />
                    <Skeleton class="h-4 w-3/4" />
                  </div>
                  
                  <!-- Model list -->
                  <template v-else-if="models[provider.id]?.length > 0">
                    <SelectItem 
                      v-for="model in models[provider.id]" 
                      :key="model.id" 
                      :value="model.id"
                    >
                      <div class="flex flex-col">
                        <span>{{ model.name || model.id }}</span>
                        <span v-if="model.contextLength" class="text-xs text-muted-foreground">
                          {{ (model.contextLength / 1000).toFixed(0) }}k context
                        </span>
                      </div>
                    </SelectItem>
                  </template>

                  <!-- No models message -->
                  <div v-else class="p-2 text-sm text-muted-foreground text-center">
                    {{ isProviderConfigured(provider.id) 
                      ? 'Click refresh to load models' 
                      : 'Add API key to load models' 
                    }}
                  </div>
                </SelectContent>
              </Select>
              
              <Button 
                size="sm"
                @click="saveModel(provider.id)"
                :disabled="!selectedModels[provider.id] || saving[`model-${provider.id}`]"
              >
                <Loader2 v-if="saving[`model-${provider.id}`]" class="h-4 w-4 mr-1 animate-spin" />
                <Check v-else-if="saved[`model-${provider.id}`]" class="h-4 w-4 mr-1 text-green-500" />
                <Save v-else class="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Info Card -->
    <Card>
      <CardContent class="pt-6">
        <div class="flex items-start gap-3">
          <AlertCircle class="h-5 w-5 text-muted-foreground mt-0.5" />
          <div class="text-sm text-muted-foreground">
            <p class="font-medium mb-1">About API Keys</p>
            <p>
              API keys are encrypted before being stored in the database. 
              Only the last 5 characters are visible for identification purposes.
              You can also configure API keys via environment variables 
              (<code class="bg-muted px-1 rounded">OPENAI_API_KEY</code>, etc.) 
              which take precedence if database values are not set.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
