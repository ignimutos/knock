import { redactByPattern } from '@logtape/redaction'
import type { LogRecord } from '@logtape/logtape'
import { DateTime } from 'luxon'
import type { LogLevel } from '../config/types.ts'

export type LogFields = Record<string, unknown>

export interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

export interface CreateLoggerOptions {
  enabled: boolean
  level: LogLevel
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

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

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
  if (value === undefined) return undefined
  if (value === null) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  return value
}

function serializeFields(fields: Record<string, unknown>): string {
  const normalized = Object.entries(fields).filter(([, value]) => value !== undefined)

  const priorityKeys = [
    'timestamp',
    'level',
    'service',
    'env',
    'component',
    'module',
    'operation',
    'message',
    'outcome',
  ]
  normalized.sort(([left], [right]) => {
    const leftPriority = priorityKeys.indexOf(left)
    const rightPriority = priorityKeys.indexOf(right)
    const leftRank = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority
    const rightRank = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.localeCompare(right)
  })

  const payload: Record<string, unknown> = {}
  for (const [key, value] of normalized) {
    payload[key] = value
  }
  return JSON.stringify(payload)
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
  if (value === undefined) return undefined
  if (value === null) return ''

  if (SENSITIVE_FIELD_KEYS.has(fieldKey)) return '****'

  if (typeof value === 'string') {
    const normalized = normalizeValue(value)
    if (typeof normalized !== 'string') return normalized
    if (URL_FIELD_KEYS.has(fieldKey)) return sanitizeUrl(normalized)
    return redactText(normalized)
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(fieldKey, item))
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
 * - 所有字段都会统一序列化为 `snake_case`
 * - 脱敏通过 LogTape 官方 redaction 执行
 * - child logger 只叠加上下文字段，不改变 level 与 enabled 行为
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const now = options.now ?? (() => new Date())
  const timezone = options.timezone ?? 'UTC'
  const timestampFormat = options.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss'
  const writeStdout = options.writeStdout ?? ((line: string) => console.log(line))
  const writeWarn = options.writeWarn ?? ((line: string) => console.warn(line))
  const writeStderr = options.writeStderr ?? ((line: string) => console.error(line))
  const baseFields = {
    service: options.service ?? 'knock',
    env: options.env ?? 'dev',
    component: options.component,
    ...options.baseFields,
  }

  const emitLog = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (!options.enabled) return
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return

    const merged = {
      ...baseFields,
      ...fields,
      timestamp: formatTime(now(), timezone, timestampFormat),
      level,
      service: baseFields.service,
      env: baseFields.env,
      module: typeof fields.module === 'string' ? fields.module : options.module,
      operation: fields.operation,
      message,
      outcome: fields.outcome,
    }
    const line = serializeFields(sanitizeFields(merged))

    if (level === 'error') {
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
    child: (fields: LogFields) => {
      const nextFields = { ...fields }
      const moduleOverride = typeof nextFields.module === 'string' ? nextFields.module : undefined
      if (moduleOverride) delete nextFields.module
      return createLogger({
        ...options,
        module: moduleOverride ?? options.module,
        baseFields: { ...baseFields, ...nextFields },
      })
    },
  }
}
