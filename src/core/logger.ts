import { getPrettyFormatter } from '@logtape/pretty'
import { redactByPattern } from '@logtape/redaction'
import type { LogRecord } from '@logtape/logtape'
import { fromFileUrl } from '@std/path'
import { DateTime } from 'luxon'
import type { LogFormat, LogLevel } from '../config/types.ts'

export type LogFields = Record<string, unknown>

const LOG_FIELDS_SYMBOL = Symbol('knock.log.fields')

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
  format?: LogFormat
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

interface OTelLogRecord {
  timeUnixNano: string
  observedTimeUnixNano: string
  severityText: string
  severityNumber: number
  body: string
  trace_id?: string
  span_id?: string
  trace_flags?: string
  resource: {
    attributes: Record<string, unknown>
  }
  scope: {
    name: string
  }
  attributes: Record<string, unknown>
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

const SEVERITY_NUMBER: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

const LOGGER_FILE_MARKER = '/src/core/logger.ts'
const DEFAULT_CODE_ATTRIBUTES_CACHE_LIMIT = 1024
const codeAttributesCache = new Map<string, Record<string, unknown> | null>()

function formatTime(input: Date, timezone: string, timestampFormat: string): string {
  return DateTime.fromJSDate(input, { zone: timezone }).toFormat(timestampFormat)
}

function formatRunIdTime(input: Date): string {
  const yyyy = `${input.getUTCFullYear()}`
  const mm = `${input.getUTCMonth() + 1}`.padStart(2, '0')
  const dd = `${input.getUTCDate()}`.padStart(2, '0')
  const hh = `${input.getUTCHours()}`.padStart(2, '0')
  const mi = `${input.getUTCMinutes()}`.padStart(2, '0')
  const ss = `${input.getUTCSeconds()}`.padStart(2, '0')
  const ms = `${input.getUTCMilliseconds()}`.padStart(3, '0')
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}${ms}Z`
}

function toSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s\-]+/g, '_')
    .toLowerCase()
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  return value
}

const SENSITIVE_FIELD_KEYS = new Set([
  'token',
  'secret',
  'password',
  'authorization',
  'api_key',
  'apikey',
  'auth',
  'sig',
  'signature',
  'access_token',
  'chat_id',
  'chatid',
  'content',
  'text',
  'body',
])

const URL_FIELD_KEYS = new Set(['url', 'source_url'])

const redactTextLine = redactByPattern(
  (record: LogRecord) => String(record.properties.line ?? ''),
  [
    {
      pattern: /(https:\/\/api\.telegram\.org\/bot)([^\/\s]+)(\/)/gi,
      replacement: '$1****$3',
    },
    {
      pattern: /(https?:\/\/)(?:[^\/@\s:]+(?::[^\/@\s]*)?@)/gi,
      replacement: '$1',
    },
    {
      pattern:
        /([?&](?:token|secret|password|authorization|api_key|apikey|auth|sig|signature|access_token)=)([^&\s"]+)/gi,
      replacement: '$1****',
    },
    {
      pattern:
        /\b(token|secret|password|authorization|api_key|apikey|auth|sig|signature|access_token)=([^\s"]+)/gi,
      replacement: '$1=****',
    },
    {
      pattern: /\b(chat_id|chatid)=([^\s"]+)/gi,
      replacement: '$1=****',
    },
    {
      pattern: /(\bbody=)(\{[^}]*\}|[^\s"]+)/gi,
      replacement: '$1****',
    },
  ],
)

function redactText(text: string): string {
  const record: LogRecord = {
    category: ['knock', 'structured'],
    level: 'info',
    message: [text],
    rawMessage: text,
    properties: { line: text },
    timestamp: Date.now(),
  }
  return String(redactTextLine(record)).replace(/\s+/g, ' ').trim()
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''

    if (url.hostname === 'api.telegram.org' && url.pathname.startsWith('/bot')) {
      const segments = url.pathname.split('/')
      if (segments.length > 1 && segments[1].startsWith('bot')) {
        segments[1] = 'bot****'
      }
      url.pathname = segments.join('/')
    }

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_FIELD_KEYS.has(toSnakeCase(key))) {
        url.searchParams.delete(key)
      }
    }

    return url.toString()
  } catch {
    return redactText(value)
  }
}

function sanitizeValue(fieldKey: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined

  if (SENSITIVE_FIELD_KEYS.has(fieldKey)) return '****'

  if (typeof value === 'string') {
    const normalized = normalizeValue(value)
    if (typeof normalized !== 'string') return normalized
    if (URL_FIELD_KEYS.has(fieldKey)) return sanitizeUrl(normalized)
    return redactText(normalized)
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? '' : sanitizeValue(fieldKey, item)))
  }

  if (typeof value === 'object') {
    return sanitizeFields(value as Record<string, unknown>)
  }

  return value
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const snakeKey = toSnakeCase(key)
    const sanitizedValue = sanitizeValue(snakeKey, value)
    if (sanitizedValue !== undefined) {
      sanitized[snakeKey] = sanitizedValue
    }
  }
  return sanitized
}

function toUnixNano(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString()
}

function extractStringField(
  fields: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return undefined
}

function isLowerHex(value: string, length: number): boolean {
  return new RegExp(`^[0-9a-f]{${length}}$`).test(value)
}

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value)
}

function normalizeTraceContext(fields: Record<string, unknown>): {
  trace_id?: string
  span_id?: string
  trace_flags?: string
} {
  const trace_id = extractStringField(fields, 'trace_id', 'traceId')
  const span_id = extractStringField(fields, 'span_id', 'spanId')
  const trace_flags = extractStringField(fields, 'trace_flags', 'traceFlags')

  const validTraceId =
    trace_id && isLowerHex(trace_id, 32) && !isAllZeroHex(trace_id) ? trace_id : undefined
  const validSpanId =
    span_id && isLowerHex(span_id, 16) && !isAllZeroHex(span_id) ? span_id : undefined
  const validTraceFlags = trace_flags && isLowerHex(trace_flags, 2) ? trace_flags : undefined

  if (validSpanId && !validTraceId) {
    return {}
  }

  return {
    ...(validTraceId ? { trace_id: validTraceId } : {}),
    ...(validSpanId ? { span_id: validSpanId } : {}),
    ...(validTraceFlags ? { trace_flags: validTraceFlags } : {}),
  }
}

function remapAttributeKey(key: string): string {
  switch (key) {
    case 'method':
    case 'http_method':
      return 'http.request.method'
    case 'route':
      return 'http.route'
    case 'http_status':
      return 'http.response.status_code'
    case 'error_name':
      return 'exception.type'
    case 'error_message':
      return 'exception.message'
    case 'stack':
      return 'exception.stacktrace'
    default:
      return key
  }
}

function normalizeAttributeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue

    const normalizedKey = toSnakeCase(key)
    if (
      normalizedKey === 'module' ||
      normalizedKey === 'trace_id' ||
      normalizedKey === 'span_id' ||
      normalizedKey === 'trace_flags' ||
      normalizedKey === 'service' ||
      normalizedKey === 'env' ||
      normalizedKey === 'component'
    ) {
      continue
    }

    normalized[remapAttributeKey(normalizedKey)] = value
  }

  return sanitizeFields(normalized)
}

const PRETTY_INFO_ATTRIBUTE_KEYS = new Set([
  'source.id',
  'source.run_id',
  'delivery.id',
  'web.request_id',
  'http.request.method',
  'http.route',
  'http.response.status_code',
])

function selectPrettyAttributes(record: OTelLogRecord): Record<string, unknown> {
  if (record.severityText !== 'INFO') {
    return record.attributes
  }

  return Object.fromEntries(
    Object.entries(record.attributes).filter(([key]) => PRETTY_INFO_ATTRIBUTE_KEYS.has(key)),
  )
}

function formatPretty(
  record: OTelLogRecord,
  options: {
    timestamp: Date
    timezone: string
    timestampFormat: string
    prettyFormatter: ReturnType<typeof getPrettyFormatter>
  },
): string {
  const level = record.severityText.toLowerCase()
  const prettyLevel = level === 'warn' ? 'warning' : level
  const line = options.prettyFormatter({
    category: ['knock', record.scope.name],
    level: prettyLevel as LogRecord['level'],
    message: [record.body],
    rawMessage: record.body,
    properties: {
      ...(record.trace_id ? { trace_id: record.trace_id } : {}),
      ...(record.span_id ? { span_id: record.span_id } : {}),
      ...(record.trace_flags ? { trace_flags: record.trace_flags } : {}),
      resource: record.resource.attributes,
      attributes: selectPrettyAttributes(record),
    },
    timestamp: options.timestamp.getTime(),
  } as LogRecord)

  return `${formatTime(options.timestamp, options.timezone, options.timestampFormat)} ${line}`.trimEnd()
}

function toPathname(location: string): string {
  if (location.startsWith('file://')) {
    try {
      return fromFileUrl(location)
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

function buildLogRecord(input: {
  level: LogLevel
  message: string
  module: string
  timestamp: Date
  resourceAttributes: Record<string, unknown>
  attributes: Record<string, unknown>
  traceContext: {
    trace_id?: string
    span_id?: string
    trace_flags?: string
  }
}): OTelLogRecord {
  return {
    timeUnixNano: toUnixNano(input.timestamp),
    observedTimeUnixNano: toUnixNano(input.timestamp),
    severityText: input.level.toUpperCase(),
    severityNumber: SEVERITY_NUMBER[input.level],
    body: redactText(input.message),
    ...input.traceContext,
    resource: {
      attributes: sanitizeFields(input.resourceAttributes),
    },
    scope: {
      name: input.module,
    },
    attributes: input.attributes,
  }
}

/**
 * 生成一次 source 执行的关联 ID，保证跨模块日志可按 run_id 聚合。
 */
export function createRunId(sourceId: string, now: Date = new Date()): string {
  return `source.${sourceId}.${formatRunIdTime(now)}`
}

/**
 * 创建结构化 logger。
 *
 * 契约：
 * - 默认 JSON 输出遵循 OTel/OTLP 风格字段
 * - pretty 与 json 共用同一份脱敏后的记录数据源
 * - child logger 只叠加上下文字段，不改变 level 与 enabled 行为
 */
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
  const prettyFormatter =
    format === 'pretty'
      ? getPrettyFormatter({
          colors: true,
          timestamp: 'none',
          properties: true,
          categorySeparator: '·',
          categoryTruncate: false,
          categoryWidth: 0,
          icons: true,
          align: true,
          wordWrap: false,
        })
      : undefined

  const emitLog = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (!options.enabled) return
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return

    const timestamp = now()
    const mergedFields = { ...baseFields, ...fields }
    const module = typeof mergedFields.module === 'string' ? mergedFields.module : options.module
    const traceContext = normalizeTraceContext(mergedFields)

    const attributes = {
      ...getCodeAttributes(),
      ...normalizeAttributeFields(mergedFields),
    }

    const record = buildLogRecord({
      level,
      message,
      module,
      timestamp,
      resourceAttributes,
      attributes,
      traceContext,
    })

    const line =
      format === 'pretty' && prettyFormatter
        ? formatPretty(record, { timestamp, timezone, timestampFormat, prettyFormatter })
        : JSON.stringify(record)

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
