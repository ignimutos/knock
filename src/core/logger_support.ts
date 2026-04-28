import type { LogRecord, TextFormatter } from '@logtape/logtape'
import { createColors } from 'picocolors'
import { DateTime } from 'luxon'

const { bold, cyan, dim, gray, green, magenta, red, yellow } = createColors(true)
import type { LogLevel } from '../config/types.ts'

export interface OTelLogRecord {
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

const SEVERITY_NUMBER: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

export const SENSITIVE_FIELD_NAMES = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api_key/i,
  /apikey/i,
  /auth/i,
  /sig/i,
  /signature/i,
  /access_token/i,
  /chat_id/i,
  /chatid/i,
  /content/i,
  /text/i,
  /body/i,
]

export const SENSITIVE_PATTERNS = [
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
] as const

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

const PRETTY_INFO_ATTRIBUTE_KEYS = new Set([
  'source.id',
  'source.run_id',
  'delivery.id',
  'web.request_id',
  'http.request.method',
  'http.route',
  'http.response.status_code',
  'web.duration_ms',
])

function formatTime(input: Date, timezone: string, timestampFormat: string): string {
  return DateTime.fromJSDate(input, { zone: timezone }).toFormat(timestampFormat)
}

export function formatRunIdTime(input: Date): string {
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

function redactText(text: string): string {
  let redacted = text
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    redacted = redacted.replaceAll(pattern, replacement)
  }
  return redacted.replace(/\s+/g, ' ').trim()
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

export function normalizeTraceContext(fields: Record<string, unknown>): {
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

export function normalizeAttributeFields(fields: Record<string, unknown>): Record<string, unknown> {
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

function selectPrettyAttributes(record: OTelLogRecord): Record<string, unknown> {
  if (record.severityText !== 'INFO') {
    return record.attributes
  }

  return Object.fromEntries(
    Object.entries(record.attributes).filter(([key]) => PRETTY_INFO_ATTRIBUTE_KEYS.has(key)),
  )
}

function colorizePrettySeverity(level: string): string {
  switch (level) {
    case 'trace':
      return dim(level)
    case 'debug':
      return magenta(level)
    case 'info':
      return green(level)
    case 'warn':
      return yellow(level)
    case 'error':
      return red(level)
    case 'fatal':
      return bold(red(level))
    default:
      return level
  }
}

function colorizePrettyScope(scope: string): string {
  return cyan(scope)
}

function colorizePrettyTimestamp(timestamp: string): string {
  return gray(timestamp)
}

function colorizePrettyKey(key: string): string {
  return dim(key)
}

export function toOtelLogRecord(record: LogRecord): OTelLogRecord {
  const properties = record.properties as Record<string, unknown>
  const message =
    typeof record.rawMessage === 'string' ? record.rawMessage : String(record.message[0] ?? '')
  const resourceAttributes =
    properties.resource && typeof properties.resource === 'object'
      ? (properties.resource as Record<string, unknown>)
      : {}
  const eventAttributes =
    properties.attributes && typeof properties.attributes === 'object'
      ? (properties.attributes as Record<string, unknown>)
      : {}
  const repositoryLevel = record.level === 'warning' ? 'warn' : (record.level as LogLevel)

  return {
    timeUnixNano: toUnixNano(new Date(record.timestamp)),
    observedTimeUnixNano: toUnixNano(new Date(record.timestamp)),
    severityText: repositoryLevel.toUpperCase(),
    severityNumber: SEVERITY_NUMBER[repositoryLevel],
    body: redactText(message),
    ...(typeof properties.trace_id === 'string' ? { trace_id: properties.trace_id } : {}),
    ...(typeof properties.span_id === 'string' ? { span_id: properties.span_id } : {}),
    ...(typeof properties.trace_flags === 'string' ? { trace_flags: properties.trace_flags } : {}),
    resource: {
      attributes: sanitizeFields(resourceAttributes),
    },
    scope: {
      name: record.category.slice(1).join('.') || record.category.join('.'),
    },
    attributes: sanitizeFields(eventAttributes),
  }
}

export function buildLogTapeRecord(input: {
  level: LogLevel
  message: string
  timestamp: Date
  resourceAttributes: Record<string, unknown>
  attributes: Record<string, unknown>
  traceContext: {
    trace_id?: string
    span_id?: string
    trace_flags?: string
  }
}): Omit<LogRecord, 'category'> {
  return {
    level: input.level === 'warn' ? 'warning' : input.level,
    message: [input.message],
    rawMessage: input.message,
    timestamp: input.timestamp.getTime(),
    properties: {
      resource: input.resourceAttributes,
      attributes: input.attributes,
      ...input.traceContext,
    },
  }
}

export function createRepositoryJsonlFormatter(): TextFormatter {
  return (record: LogRecord): string => `${JSON.stringify(toOtelLogRecord(record))}\n`
}

export function createPrettyFormatter(options: {
  timezone: string
  timestampFormat: string
}): TextFormatter {
  return (record: LogRecord): string => {
    const otelRecord = toOtelLogRecord(record)
    const scope = otelRecord.scope.name.split('.').at(-1) ?? otelRecord.scope.name
    const component = otelRecord.resource.attributes['knock.component']
    const attributes = selectPrettyAttributes(otelRecord)
    const timestamp = formatTime(
      new Date(Number(otelRecord.timeUnixNano) / 1_000_000),
      options.timezone,
      options.timestampFormat,
    )
    const severity = otelRecord.severityText.toLowerCase()
    const inline = Object.entries(attributes)
      .map(([key, value]) => `${colorizePrettyKey(key)}=${String(value)}`)
      .join(' ')

    return `${colorizePrettyTimestamp(timestamp)} ${colorizePrettySeverity(severity)} ${colorizePrettyScope(scope)} ${otelRecord.body}${component ? ` ${colorizePrettyKey('component')}=${String(component)}` : ''}${inline ? ` ${inline}` : ''}`
  }
}
