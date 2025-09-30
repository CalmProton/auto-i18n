import { beforeAll, afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type EnvModule = typeof import('../src/config/env')

type FileStorageModule = typeof import('../src/utils/fileStorage')

type BatchServiceModule = typeof import('../src/services/translation/openaiBatchService')

let tempDir: string
let envModule: EnvModule
let fileStorageModule: FileStorageModule
let batchServiceModule: BatchServiceModule

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'auto-i18n-batch-test-'))
  process.env.AUTO_I18N_TEMP_DIR = tempDir
  process.env.TRANSLATION_PROVIDER = 'openai'
  process.env.OPENAI_API_KEY = 'test-api-key'
  delete process.env.OPENAI_MODEL

  envModule = await import('../src/config/env')
  envModule.resetTranslationConfigCache()

  fileStorageModule = await import('../src/utils/fileStorage')
  batchServiceModule = await import('../src/services/translation/openaiBatchService')
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.AUTO_I18N_TEMP_DIR
  delete process.env.TRANSLATION_PROVIDER
  delete process.env.OPENAI_API_KEY
  envModule?.resetTranslationConfigCache()
})

describe('createContentBatch', () => {
  it('builds a JSONL file with expected payload', async () => {
    const senderId = 'ci-pipeline'
    const sourceLocale = 'en'
    const targetLocales = ['fr']

    const markdown = ['---', 'title: Example', '---', '', '# Hello world'].join('\n')
    const uploadFiles = [
      {
        file: new File([markdown], 'example.md', { type: 'text/markdown' })
      }
    ]

    await fileStorageModule.saveFilesToTemp(
      { senderId, locale: sourceLocale, type: 'content', category: 'uploads' },
      uploadFiles
    )

    const result = await batchServiceModule.createContentBatch({
      senderId,
      sourceLocale,
      targetLocales
    })

    expect(result.batchId).toMatch(/^batch_en_/)
    expect(result.requestCount).toBe(1)

    const jsonlText = await Bun.file(result.inputFilePath).text()
    const lines = jsonlText.trim().split('\n')
    expect(lines).toHaveLength(1)

    const payload = JSON.parse(lines[0])
    expect(payload.custom_id).toContain('markdown_fr')
    expect(payload.method).toBe('POST')
    expect(payload.url).toBe('/v1/chat/completions')
    expect(payload.body.model).toBe('gpt-5-mini')
    expect(payload.body.messages[0].role).toBe('system')
    expect(payload.body.messages[1].content).toContain('# Hello world')

    // Manifest matches the generated request metadata
    const manifest = result.manifest
    expect(manifest.totalRequests).toBe(1)
    expect(manifest.files[0]?.relativePath).toBe('example.md')
    expect(manifest.files[0]?.targetLocale).toBe('fr')
    expect(manifest.status).toBe('draft')
  })
})
