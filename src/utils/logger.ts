import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inspect } from 'node:util'
import winston from 'winston'

const DEFAULT_LOG_DIR = '/tmp/logs'
const LOG_DIR = resolve(process.env.AUTO_I18N_LOG_DIR ?? DEFAULT_LOG_DIR)
const LOG_FILE_NAME = process.env.AUTO_I18N_LOG_FILE ?? 'auto-i18n.log'
const MAX_CONSOLE_META_LENGTH = Number.parseInt(process.env.AUTO_I18N_MAX_CONSOLE_META ?? '600', 10)

function ensureLogDirectory(directory: string) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }
}

ensureLogDirectory(LOG_DIR)

const timestampFormat = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' })
const errorFormat = winston.format.errors({ stack: true })
const metadataFormat = winston.format.metadata({ fillExcept: ['timestamp', 'level', 'message', 'stack'] })

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const trimmed = value.slice(0, maxLength)
  const omitted = value.length - maxLength
  return `${trimmed}… [+${omitted} chars]`
}

function formatMetadataForConsole(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return ''
  }

  const inspected = inspect(metadata, {
    depth: 4,
    breakLength: 100,
    colors: false,
    maxArrayLength: 20,
    maxStringLength: 200
  })

  const maxLength = Number.isFinite(MAX_CONSOLE_META_LENGTH) && MAX_CONSOLE_META_LENGTH > 0
    ? MAX_CONSOLE_META_LENGTH
    : 600

  return truncate(inspected, maxLength)
}

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    timestampFormat,
    errorFormat,
    metadataFormat,
    winston.format.printf((info) => {
      const { timestamp, level, message, stack, metadata } = info as winston.Logform.TransformableInfo & {
        metadata?: Record<string, unknown>
      }

      const metaString = formatMetadataForConsole(metadata)
      const baseMessage = stack ? `${message}\n${stack}` : message
      return metaString
        ? `${timestamp} ${level}: ${baseMessage} | ${metaString}`
        : `${timestamp} ${level}: ${baseMessage}`
    })
  )
})

const fileTransport = new winston.transports.File({
  filename: join(LOG_DIR, LOG_FILE_NAME),
  maxsize: Number.parseInt(process.env.AUTO_I18N_LOG_FILE_MAX_SIZE ?? `${20 * 1024 * 1024}`, 10),
  maxFiles: Number.parseInt(process.env.AUTO_I18N_LOG_FILE_MAX_FILES ?? '5', 10),
  tailable: true,
  format: winston.format.combine(
    timestampFormat,
    errorFormat,
    metadataFormat,
    winston.format.json()
  )
})

const logger = winston.createLogger({
  level: process.env.AUTO_I18N_LOG_LEVEL ?? 'info',
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
  transports: [consoleTransport, fileTransport]
})

export type Logger = winston.Logger

export function createScopedLogger(scope: string, defaultMeta: Record<string, unknown> = {}): Logger {
  return logger.child({ scope, ...defaultMeta })
}

export function getLogger(): Logger {
  return logger
}

export function annotateError(error: unknown, context: Record<string, unknown>): unknown {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    return Object.assign(error as Record<string, unknown>, context)
  }
  return error
}

export const logPaths = {
  directory: LOG_DIR,
  file: join(LOG_DIR, LOG_FILE_NAME)
}

export default logger
