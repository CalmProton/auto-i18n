<template>
  <div class="max-w-2xl">
    <div v-if="pending" class="text-sm text-gray-500">Loading settings...</div>
    <div v-else-if="error" class="text-sm text-error">Failed to load settings</div>
    <div v-else>
      <form @submit.prevent="save" class="space-y-0 border border-gray-700">
        <!-- Section header -->
        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
          API Keys
        </div>
        <SettingField v-model="form['ACCESS_KEY']" label="Access Key" name="ACCESS_KEY" sensitive />
        <SettingField v-model="form['OPENROUTER_API_KEY']" label="OpenRouter API Key" name="OPENROUTER_API_KEY" sensitive />
        <SettingField v-model="form['OPENAI_API_KEY']" label="OpenAI API Key (batch)" name="OPENAI_API_KEY" sensitive />
        <SettingField v-model="form['ANTHROPIC_API_KEY']" label="Anthropic API Key (batch)" name="ANTHROPIC_API_KEY" sensitive />

        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 border-t border-t-gray-700 text-xs uppercase tracking-wider text-gray-400">
          Models
        </div>
        <SettingField v-model="form['OPENROUTER_MODEL']" label="OpenRouter Model (realtime)" name="OPENROUTER_MODEL" />
        <SettingField v-model="form['OPENAI_BATCH_MODEL']" label="OpenAI Batch Model" name="OPENAI_BATCH_MODEL" />
        <SettingField v-model="form['ANTHROPIC_BATCH_MODEL']" label="Anthropic Batch Model" name="ANTHROPIC_BATCH_MODEL" />

        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 border-t border-t-gray-700 text-xs uppercase tracking-wider text-gray-400">
          Translation
        </div>
        <SettingField v-model="form['BATCH_PROVIDER']" label="Batch Provider (auto/openai/anthropic)" name="BATCH_PROVIDER" />
        <SettingField v-model="form['MOCK_MODE']" label="Mock Mode (true/false)" name="MOCK_MODE" />

        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 border-t border-t-gray-700 text-xs uppercase tracking-wider text-gray-400">
          Git Forge
        </div>
        <SettingField v-model="form['GIT_FORGE']" label="Git Forge (none/github/gitlab/webhook)" name="GIT_FORGE" />
        <SettingField v-model="form['GIT_TOKEN']" label="Git Token" name="GIT_TOKEN" sensitive />
        <SettingField v-model="form['GIT_CREATE_ISSUES']" label="Create Issues (true/false)" name="GIT_CREATE_ISSUES" />
        <SettingField v-model="form['WEBHOOK_URL']" label="Webhook URL" name="WEBHOOK_URL" />

        <div class="px-4 py-2 bg-gray-900 border-b border-gray-700 border-t border-t-gray-700 text-xs uppercase tracking-wider text-gray-400">
          Prompts
        </div>
        <SettingField v-model="form['SYSTEM_PROMPT']" label="System Prompt" name="SYSTEM_PROMPT" multiline />
        <SettingField v-model="form['MARKDOWN_USER_PROMPT']" label="Markdown User Prompt" name="MARKDOWN_USER_PROMPT" multiline />
        <SettingField v-model="form['JSON_USER_PROMPT']" label="JSON User Prompt" name="JSON_USER_PROMPT" multiline />

        <!-- Save -->
        <div class="px-4 py-3 border-t border-gray-700 flex items-center gap-4">
          <button
            type="submit"
            :disabled="saving"
            class="px-5 py-2 bg-white text-black text-xs font-bold uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {{ saving ? 'Saving...' : 'Save Settings' }}
          </button>
          <span v-if="saveMsg" class="text-xs" :class="saveMsg.ok ? 'text-success' : 'text-error'">
            {{ saveMsg.text }}
          </span>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const { data, pending, error } = await useFetch('/api/settings')

const form = ref<Record<string, string>>({})
const saving = ref(false)
const saveMsg = ref<{ ok: boolean; text: string } | null>(null)

watch(data, (d) => {
  if (d?.settings) form.value = { ...d.settings }
}, { immediate: true })

async function save() {
  saving.value = true
  saveMsg.value = null
  try {
    await $fetch('/api/settings', { method: 'PUT', body: form.value })
    saveMsg.value = { ok: true, text: '✓ Saved' }
  } catch {
    saveMsg.value = { ok: false, text: '✗ Save failed' }
  } finally {
    saving.value = false
    setTimeout(() => { saveMsg.value = null }, 3000)
  }
}
</script>
