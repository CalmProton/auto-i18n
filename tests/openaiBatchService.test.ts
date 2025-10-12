import { beforeAll, afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPPORTED_LOCALES } from '../server/config/locales'

type EnvModule = typeof import('../server/config/env')

type FileStorageModule = typeof import('../server/utils/fileStorage')

type BatchServiceModule = typeof import('../server/services/translation/openaiBatchService')

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

  envModule = await import('../server/config/env')
  envModule.resetTranslationConfigCache()

  fileStorageModule = await import('../server/utils/fileStorage')
  batchServiceModule = await import('../server/services/translation/openaiBatchService')
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.AUTO_I18N_TEMP_DIR
  delete process.env.TRANSLATION_PROVIDER
  delete process.env.OPENAI_API_KEY
  envModule?.resetTranslationConfigCache()
})

describe('createBatch', () => {
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

    const result = await batchServiceModule.createBatch({
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
  expect(payload.custom_id).toContain('markdown_content_fr')
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
    expect(manifest.files[0]?.type).toBe('content')
    expect(manifest.files[0]?.format).toBe('markdown')
    expect(manifest.types).toEqual(['content'])
    expect(manifest.status).toBe('draft')
  })

  it('accepts "all" for targetLocales and includeFiles', async () => {
    const senderId = 'ci-pipeline-all'
    const sourceLocale = 'en'

    const markdownA = ['# Welcome', 'This is a guide.'].join('\n')
    const markdownB = ['# Another Doc', 'Content here.'].join('\n')

    await fileStorageModule.saveFilesToTemp(
      { senderId, locale: sourceLocale, type: 'content', category: 'uploads' },
      [
        { file: new File([markdownA], 'welcome.md', { type: 'text/markdown' }) },
        { file: new File([markdownB], 'doc.md', { type: 'text/markdown' }), folderName: 'guides' }
      ]
    )

    const expectedTargets = SUPPORTED_LOCALES.map((locale) => locale.code)
      .filter((code) => code !== sourceLocale)
      .sort()

    const result = await batchServiceModule.createBatch({
      senderId,
      sourceLocale,
      targetLocales: 'all',
      includeFiles: 'all'
    })

    expect(result.manifest.targetLocales).toEqual(expectedTargets)
    expect(result.requestCount).toBe(expectedTargets.length * 2)

    const recordedPaths = new Set(result.manifest.files.map((file) => file.relativePath))
    expect(recordedPaths).toEqual(new Set(['welcome.md', 'guides/doc.md']))
    expect(result.manifest.types).toEqual(['content'])
  })

  it('includes global and page JSON uploads', async () => {
    const senderId = 'ci-pipeline-json'
    const sourceLocale = 'en'

    const globalData = { greeting: 'Hello', nested: { info: 'Details' } }
    await fileStorageModule.saveFileToTemp({
      senderId,
      locale: sourceLocale,
      type: 'global',
      category: 'uploads',
      file: new File([JSON.stringify(globalData)], 'en.json', { type: 'application/json' })
    })

    await fileStorageModule.saveFilesToTemp(
      { senderId, locale: sourceLocale, type: 'page', category: 'uploads' },
      [
        {
          folderName: 'home',
          file: new File([JSON.stringify({ title: 'Home', body: 'Welcome!' })], 'en.json', {
            type: 'application/json'
          })
        }
      ]
    )

    const result = await batchServiceModule.createBatch({
      senderId,
      sourceLocale,
      targetLocales: ['fr']
    })

    expect(result.requestCount).toBe(2)
  expect([...result.manifest.types].sort()).toEqual(['global', 'page'])

    const fileTypes = result.manifest.files.map((file) => file.type)
    expect(new Set(fileTypes)).toEqual(new Set(['global', 'page']))
    result.manifest.files.forEach((file) => {
      expect(file.format).toBe('json')
      expect(file.targetLocale).toBe('fr')
    })

    const jsonlText = await Bun.file(result.inputFilePath).text()
    const lines = jsonlText.trim().split('\n')
    expect(lines).toHaveLength(2)

    const payloads = lines.map((line) => JSON.parse(line))
    payloads.forEach((payload) => {
      expect(payload.body.response_format).toEqual({ type: 'json_object' })
      expect(payload.custom_id).toContain('json_')
    })
  })
})
