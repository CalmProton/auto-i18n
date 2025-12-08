import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTempRoot } from './fileStorage'

export function sanitizeBatchSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function resolveSenderBatchRoot(senderId: string): string {
  const sanitizedSender = sanitizeBatchSegment(senderId)
  return join(getTempRoot(), sanitizedSender, 'batches')
}

function resolveBatchDirectory(senderId: string, batchId: string): string {
  const sanitizedBatchId = sanitizeBatchSegment(batchId)
  return join(resolveSenderBatchRoot(senderId), sanitizedBatchId)
}

export function ensureBatchDirectory(senderId: string, batchId: string): string {
  const directory = resolveBatchDirectory(senderId, batchId)
  ensureDirectory(directory)
  return directory
}

export function writeBatchFile(senderId: string, batchId: string, fileName: string, content: string | NodeJS.ArrayBufferView): string {
  const directory = ensureBatchDirectory(senderId, batchId)
  const filePath = join(directory, fileName)
  writeFileSync(filePath, content)
  return filePath
}

export function readBatchFile(senderId: string, batchId: string, fileName: string): string {
  const directory = resolveBatchDirectory(senderId, batchId)
  const filePath = join(directory, fileName)
  return readFileSync(filePath, 'utf8')
}

export function batchFileExists(senderId: string, batchId: string, fileName: string): boolean {
  const directory = resolveBatchDirectory(senderId, batchId)
  const filePath = join(directory, fileName)
  return existsSync(filePath)
}

export function getBatchFilePath(senderId: string, batchId: string, fileName: string): string {
  const directory = resolveBatchDirectory(senderId, batchId)
  return join(directory, fileName)
}
