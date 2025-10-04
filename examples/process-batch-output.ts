#!/usr/bin/env bun

/**
 * Example script showing how to process OpenAI batch output
 * 
 * Usage:
 *   bun examples/process-batch-output.ts <batchId> <outputFile>
 * 
 * Example:
 *   bun examples/process-batch-output.ts batch_en_1759535513121_a066c38c batch_output.jsonl
 */

import { readFile } from 'fs/promises'

const API_BASE = process.env.API_BASE || 'http://localhost:3000'
const SENDER_ID = process.env.SENDER_ID || 'example-user'

interface ProcessBatchOutputResponse {
  message: string
  batchId: string
  senderId: string
  totalTranslations: number
  savedFiles: number
  failedFiles: number
  summary: {
    byLocale: Record<string, number>
    byType: Record<string, number>
    totalSuccess: number
    totalError: number
  }
  errors: Array<{
    customId: string
    targetLocale: string
    relativePath: string
    error: string
  }>
}

async function processBatchOutput(batchId: string, outputFilePath: string): Promise<void> {
  console.log('📁 Reading batch output file:', outputFilePath)
  
  // Read the JSONL file
  const outputContent = await readFile(outputFilePath, 'utf8')
  const lineCount = outputContent.split('\n').filter(l => l.trim()).length
  
  console.log(`✅ Read ${lineCount} lines from output file`)
  console.log(`📤 Sending to API: ${API_BASE}/batch/${batchId}/output`)
  
  // Send to API
  const response = await fetch(`${API_BASE}/batch/${batchId}/output`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      senderId: SENDER_ID,
      outputContent
    })
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(`API error: ${response.status} - ${JSON.stringify(error)}`)
  }
  
  const result = await response.json() as ProcessBatchOutputResponse
  
  // Display results
  console.log('\n✨ Batch Processing Complete!\n')
  console.log(`📊 Summary:`)
  console.log(`   Total translations: ${result.totalTranslations}`)
  console.log(`   ✅ Saved files: ${result.savedFiles}`)
  console.log(`   ❌ Failed files: ${result.failedFiles}`)
  
  console.log('\n🌍 By Locale:')
  for (const [locale, count] of Object.entries(result.summary.byLocale)) {
    console.log(`   ${locale}: ${count} files`)
  }
  
  console.log('\n📂 By Type:')
  for (const [type, count] of Object.entries(result.summary.byType)) {
    console.log(`   ${type}: ${count} files`)
  }
  
  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors:')
    result.errors.slice(0, 5).forEach((error, i) => {
      console.log(`   ${i + 1}. [${error.targetLocale}] ${error.relativePath}`)
      console.log(`      Error: ${error.error}`)
    })
    
    if (result.errors.length > 5) {
      console.log(`   ... and ${result.errors.length - 5} more errors`)
    }
  }
  
  console.log('\n📍 Translations saved to:')
  console.log(`   tmp/${SENDER_ID}/translations/`)
  
  console.log('\n🚀 Next step: Create GitHub PR')
  console.log(`   curl -X POST ${API_BASE}/github/finalize \\`)
  console.log(`     -H "Content-Type: application/json" \\`)
  console.log(`     -d '{"senderId": "${SENDER_ID}"}'`)
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('❌ Usage: bun examples/process-batch-output.ts <batchId> <outputFile>')
  console.error('\nExample:')
  console.error('  bun examples/process-batch-output.ts batch_en_1759535513121_a066c38c batch_output.jsonl')
  process.exit(1)
}

const [batchId, outputFile] = args

processBatchOutput(batchId, outputFile)
  .then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message)
    if (error.cause) {
      console.error('Cause:', error.cause)
    }
    process.exit(1)
  })
