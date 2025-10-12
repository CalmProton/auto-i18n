/**
 * Example: Retry failed batch requests
 * 
 * This script demonstrates how to create a new batch from failed requests
 * using the error file from a previous batch run.
 */

const API_BASE_URL = 'http://localhost:3000'

interface RetryBatchRequest {
  senderId: string
  originalBatchId: string
  errorFileName: string
  model?: string
}

interface RetryBatchResponse {
  message: string
  batchId: string
  originalBatchId: string
  requestCount: number
  failedRequestCount: number
  model: string
  manifest: {
    batchId: string
    senderId: string
    types: string[]
    sourceLocale: string
    targetLocales: string[]
    model: string
    totalRequests: number
    status: string
    createdAt: string
    updatedAt: string
  }
}

async function retryFailedBatch(options: RetryBatchRequest): Promise<RetryBatchResponse> {
  const response = await fetch(`${API_BASE_URL}/batch/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(options)
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Failed to create retry batch: ${error.error || response.statusText}`)
  }

  return response.json()
}

async function submitBatch(senderId: string, batchId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/batch/${batchId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ senderId })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Failed to submit batch: ${error.error || response.statusText}`)
  }

  const result = await response.json()
  console.log('✅ Batch submitted:', result)
}

// Example usage
async function main() {
  try {
    console.log('🔄 Creating retry batch from failed requests...\n')

    const result = await retryFailedBatch({
      senderId: 'calmproton-pxguru-965169e',
      originalBatchId: 'batch_en_1760269403519_fa8a129e',
      errorFileName: 'batch_68eb94cca7cc81909cb8ed2f1dd5facd_error.jsonl',
      model: 'gpt-4.1-mini' // Use a different model to avoid quota limits
    })

    console.log('✅ Retry batch created successfully!\n')
    console.log('📋 Details:')
    console.log(`   New Batch ID: ${result.batchId}`)
    console.log(`   Original Batch ID: ${result.originalBatchId}`)
    console.log(`   Model: ${result.model}`)
    console.log(`   Failed Requests: ${result.failedRequestCount}`)
    console.log(`   Retry Requests: ${result.requestCount}`)
    console.log(`   Source Locale: ${result.manifest.sourceLocale}`)
    console.log(`   Target Locales: ${result.manifest.targetLocales.join(', ')}`)
    console.log(`   Types: ${result.manifest.types.join(', ')}`)
    console.log()

    // Optionally submit the new batch immediately
    const shouldSubmit = process.argv.includes('--submit')
    if (shouldSubmit) {
      console.log('📤 Submitting retry batch to OpenAI...\n')
      await submitBatch(result.manifest.senderId, result.batchId)
    } else {
      console.log('ℹ️  To submit this batch, run:')
      console.log(`   POST ${API_BASE_URL}/batch/${result.batchId}/submit`)
      console.log(`   Body: { "senderId": "${result.manifest.senderId}" }`)
      console.log()
      console.log('   Or run this script with --submit flag')
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
