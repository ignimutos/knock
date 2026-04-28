import { getLogger as getLogTapeLogger, type LogRecord, type Logger as LogTapeLogger } from '../platform/logtape.ts'
import { redactByPattern } from '../platform/logtape_redaction.ts'
import { fileURLToPath } from 'node:url'
import type { LogLevel } from '../config/types.ts'
import {
  buildLogTapeRecord,
  createPrettyFormatter,
  createRepositoryJsonlFormatter,
  formatRunIdTime,
  normalizeAttributeFields,
  normalizeTraceContext,
  SENSITIVE_PATTERNS,
} from './logger_support.ts'

export {
  createPrettyFormatter,
  createRepositoryJsonlFormatter,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_PATTERNS,
  toOtelLogRecord,
} from './logger_support.ts'
export type { OTelLogRecord } from './logger_support.ts'

export type LogFields = Record<string, unknown>

const LOG_FIELDS_SYMBOL = Symbol('knock.log.fields')
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}
const LOGGER_FILE_MARKER = '/src/core/logger.ts'
const DEFAULT_CODE_ATTRIBUTES_CACHE_LIMIT = 1024
const codeAttributesCache = new Map<string, Record<string, unknown> | null>()
let logTapeRuntimeActive = false

export function getLogFields(context: Record<PropertyKey, unknown>): LogFields | undefined {
  const fields = context[LOG_FIELDS_SYMBOL]
  if (!fields || typeof fields !== 'object') return undefined
  return fields as LogFields
}

export function attachLogFields<T extends Record<string, unknown>>(
  context: T,
  fields?: LogFields,
): T {
  const nextFields = {
    ...(getLogFields(context as Record<PropertyKey, unknown>) ?? {}),
    ...(fields ?? {}),
  }
  if (Object.keys(nextFields).length === 0) return context
  Object.defineProperty(context, LOG_FIELDS_SYMBOL, {
    value: nextFields,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return context
}

export interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

export interface CreateLoggerOptions {
  enabled: boolean
  level: LogLevel
  format?: 'json' | 'pretty'
  module: string
  component?: string
  service?: string
  env?: string
  timezone?: string
  timestampFormat?: string
  now?: () => Date
  writeStdout?: (line: string) => void
  writeWarn?: (line: string) => void
  writeStderr?: (line: string) => void
  baseFields?: LogFields
}

function toPathname(location: string): string {
  if (location.startsWith('file://')) {
    try {
      return fileURLToPath(location)
    } catch {
      return location
    }
  }
  return location
}

function isAbsoluteFilePath(location: string): boolean {
  return location.startsWith('/') || /^[A-Za-z]:[\\/]/.test(location)
}

function normalizeStackLocation(rawLocation: string): string {
  return rawLocation.replace(/^async\s+/, '').trim()
}

function normalizePathSeparators(path: string): string {
  return path.replaceAll('\\', '/')
}

function isLoggerSelfFrame(location: string): boolean {
  return normalizePathSeparators(location).includes(LOGGER_FILE_MARKER)
}

export function setBoundedMapEntry<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)

  while (map.size > limit) {
    const oldestKey = map.keys().next().value
    if (oldestKey === undefined) break
    map.delete(oldestKey)
  }

  return value
}

function setCodeAttributesCacheEntry(
  line: string,
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return setBoundedMapEntry(codeAttributesCache, line, value, DEFAULT_CODE_ATTRIBUTES_CACHE_LIMIT)
}

function resolveBusinessLocation(rawLocation: string): string | null {
  const normalizedLocation = normalizeStackLocation(rawLocation)
  if (normalizedLocation.startsWith('file://')) {
    const pathname = toPathname(normalizedLocation)
    return isAbsoluteFilePath(pathname) ? pathname : null
  }

  return isAbsoluteFilePath(normalizedLocation) ? normalizedLocation : null
}

function parseCodeAttributesFromStackLine(line: string): Record<string, unknown> | null {
  const cached = codeAttributesCache.get(line)
  if (cached !== undefined) return cached

  const match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/)
  if (!match) {
    return setCodeAttributesCacheEntry(line, null)
  }

  const [, functionName, rawLocation, lineNumber] = match
  const location = resolveBusinessLocation(rawLocation)
  if (!location || isLoggerSelfFrame(location)) {
    return setCodeAttributesCacheEntry(line, null)
  }

  const attributes: Record<string, unknown> = {
    'code.filepath': location,
    'code.line.number': Number(lineNumber),
  }
  if (functionName && functionName.trim() !== '') {
    attributes['code.function.name'] = functionName.trim()
  }

  return setCodeAttributesCacheEntry(line, attributes)
}

function getCodeAttributes(): Record<string, unknown> {
  try {
    const stack = new Error().stack
    if (!stack) return {}

    const lines = stack.split('\n').slice(1)
    for (const line of lines) {
      const attributes = parseCodeAttributesFromStackLine(line)
      if (attributes) return attributes
    }
  } catch {
    return {}
  }

  return {}
}

export function getKnockLogTapeLogger(category: string[]): LogTapeLogger {
  return getLogTapeLogger(['knock', ...category])
}

export function setLogTapeRuntimeActive(active: boolean): void {
  logTapeRuntimeActive = active
}

export function createRunId(sourceId: string, now: Date = new Date()): string {
  return `source.${sourceId}.${formatRunIdTime(now)}`
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const now = options.now ?? (() => new Date())
  const timezone = options.timezone ?? 'UTC'
  const timestampFormat = options.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss'
  const format = options.format ?? 'json'
  const writeStdout = options.writeStdout ?? ((line: string) => console.log(line))
  const writeWarn = options.writeWarn ?? ((line: string) => console.warn(line))
  const writeStderr = options.writeStderr ?? ((line: string) => console.error(line))
  const baseFields = { ...(options.baseFields ?? {}) }
  const resourceAttributes = {
    'service.name': options.service ?? 'knock',
    'deployment.environment.name': options.env ?? 'dev',
    ...(options.component ? { 'knock.component': options.component } : {}),
  }
  const logTapeLogger = getKnockLogTapeLogger(options.module.split('.'))

  const buildLoggerRecord = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const timestamp = now()
    const mergedFields = { ...baseFields, ...fields }
    const module = typeof mergedFields.module === 'string' ? mergedFields.module : options.module
    const traceContext = normalizeTraceContext(mergedFields)
    const attributes = {
      ...getCodeAttributes(),
      ...normalizeAttributeFields(mergedFields),
    }

    return {
      module,
      record: buildLogTapeRecord({
        level,
        message,
        timestamp,
        resourceAttributes,
        attributes,
        traceContext,
      }),
    }
  }

  const emitFallback = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (!options.enabled) return
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return

    const { module, record } = buildLoggerRecord(level, message, fields)
    const fallbackRecord = {
      category: ['knock', ...module.split('.')],
      ...record,
    } satisfies LogRecord

    const formatter =
      format === 'pretty'
        ? redactByPattern(createPrettyFormatter({ timezone, timestampFormat }), SENSITIVE_PATTERNS)
        : createRepositoryJsonlFormatter()
    const line = formatter(fallbackRecord).trimEnd()

    if (level === 'fatal' || level === 'error') {
      writeStderr(line)
      return
    }
    if (level === 'warn') {
      writeWarn(line)
      return
    }
    writeStdout(line)
  }

  const emitLog = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (!options.enabled) return
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return

    const { record } = buildLoggerRecord(level, message, fields)

    if (!logTapeRuntimeActive) {
      emitFallback(level, message, fields)
      return
    }

    try {
      logTapeLogger.emit(record)
    } catch {
      emitFallback(level, message, fields)
    }
  }

  return {
    trace: (message: string, fields?: LogFields) => emitLog('trace', message, fields),
    debug: (message: string, fields?: LogFields) => emitLog('debug', message, fields),
    info: (message: string, fields?: LogFields) => emitLog('info', message, fields),
    warn: (message: string, fields?: LogFields) => emitLog('warn', message, fields),
    error: (message: string, fields?: LogFields) => emitLog('error', message, fields),
    fatal: (message: string, fields?: LogFields) => emitLog('fatal', message, fields),
    child: (fields: LogFields) => {
      const nextFields = { ...fields }
      const moduleOverride = typeof nextFields.module === 'string' ? nextFields.module : undefined
      const componentOverride =
        typeof nextFields.component === 'string' ? nextFields.component : options.component
      if (moduleOverride) delete nextFields.module
      if (typeof nextFields.component === 'string') delete nextFields.component

      return createLogger({
        ...options,
        format,
        module: moduleOverride ?? options.module,
        component: componentOverride,
        baseFields: { ...baseFields, ...nextFields },
      })
    },
  }
}
