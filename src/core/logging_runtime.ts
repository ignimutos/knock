import { configure, dispose, getConsoleSink, type Sink } from '@logtape/logtape'
import { getFileSink, getRotatingFileSink, getTimeRotatingFileSink } from '@logtape/file'
import { redactByField, redactByPattern } from '@logtape/redaction'
import { basename, dirname, extname } from 'node:path'
import type { LoggingConfigResolved } from '../config/types.ts'
import { parseDurationMs } from '../config/runtime_semantics.ts'
import { mkdirPath } from '../platform/fs.ts'
import {
  createPrettyFormatter,
  createRepositoryJsonlFormatter,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_PATTERNS,
  setLogTapeRuntimeActive,
} from './logger.ts'

interface ConfigureLoggingRuntimeInput {
  logging: LoggingConfigResolved
  runtimeDir: string
  timezone: string
  timestampFormat: string
  consoleWriters?: {
    stdout: (line: string) => void
    warn: (line: string) => void
    stderr: (line: string) => void
  }
}

let configured = false

function createConsoleLike(
  input: NonNullable<ConfigureLoggingRuntimeInput['consoleWriters']>,
): Console {
  return {
    log: (msg?: unknown, ...args: unknown[]) => input.stdout([msg, ...args].map(String).join(' ')),
    info: (msg?: unknown, ...args: unknown[]) => input.stdout([msg, ...args].map(String).join(' ')),
    trace: (msg?: unknown, ...args: unknown[]) =>
      input.stdout([msg, ...args].map(String).join(' ')),
    debug: (msg?: unknown, ...args: unknown[]) =>
      input.stdout([msg, ...args].map(String).join(' ')),
    warn: (msg?: unknown, ...args: unknown[]) => input.warn([msg, ...args].map(String).join(' ')),
    error: (msg?: unknown, ...args: unknown[]) =>
      input.stderr([msg, ...args].map(String).join(' ')),
  } as Console
}

function parseByteSize(value: string): number {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+)(b|k|m|g)$/)
  if (!match) {
    throw new Error(`logging.sinks.file.rotation.maxSize 配置非法: ${value}`)
  }

  const amount = Number(match[1])
  const unit = match[2]
  if (unit === 'b') return amount
  if (unit === 'k') return amount * 1024
  if (unit === 'm') return amount * 1024 * 1024
  return amount * 1024 * 1024 * 1024
}

function formatRotationDate(date: Date, interval: 'hourly' | 'daily' | 'weekly'): string {
  const yyyy = `${date.getUTCFullYear()}`
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getUTCDate()}`.padStart(2, '0')
  const hh = `${date.getUTCHours()}`.padStart(2, '0')

  if (interval === 'hourly') return `${yyyy}-${mm}-${dd}-${hh}`
  if (interval === 'daily') return `${yyyy}-${mm}-${dd}`

  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1
  const week = `${Math.ceil(dayOfYear / 7)}`.padStart(2, '0')
  return `${yyyy}-W${week}`
}

function buildConsoleSink(input: ConfigureLoggingRuntimeInput): Sink {
  const sink = input.logging.sinks.console
  if (!sink) throw new Error('console sink 未配置')

  const formatter = redactByPattern(
    sink.format === 'pretty'
      ? createPrettyFormatter({
          timezone: input.timezone,
          timestampFormat: input.timestampFormat,
        })
      : createRepositoryJsonlFormatter(),
    SENSITIVE_PATTERNS,
  )

  if (input.consoleWriters) {
    return redactByField(
      getConsoleSink({
        formatter,
        console: createConsoleLike(input.consoleWriters),
      }),
      {
        fieldPatterns: SENSITIVE_FIELD_NAMES,
        action: () => '****',
      },
    )
  }

  return redactByField(getConsoleSink({ formatter }), {
    fieldPatterns: SENSITIVE_FIELD_NAMES,
    action: () => '****',
  })
}

function buildFileSink(input: ConfigureLoggingRuntimeInput): Sink {
  const sink = input.logging.sinks.file
  if (!sink) throw new Error('file sink 未配置')

  const formatter = redactByPattern(createRepositoryJsonlFormatter(), SENSITIVE_PATTERNS)
  const options = {
    formatter,
    nonBlocking: true as const,
  }

  if (!sink.rotation) {
    return redactByField(getFileSink(sink.path, options), {
      fieldPatterns: SENSITIVE_FIELD_NAMES,
      action: () => '****',
    })
  }

  if (sink.rotation.type === 'size') {
    return redactByField(
      getRotatingFileSink(sink.path, {
        ...options,
        maxSize: parseByteSize(sink.rotation.maxSize),
        maxFiles: sink.rotation.maxFiles,
      }),
      {
        fieldPatterns: SENSITIVE_FIELD_NAMES,
        action: () => '****',
      },
    )
  }

  const rotation = sink.rotation
  return redactByField(
    getTimeRotatingFileSink({
      ...options,
      directory: dirname(sink.path),
      interval: rotation.interval,
      maxAgeMs: parseDurationMs(rotation.maxAge, 'logging.sinks.file.rotation.maxAge'),
      filename: (date) =>
        `${basename(sink.path, extname(sink.path))}-${formatRotationDate(date, rotation.interval)}${extname(sink.path)}`,
    }),
    {
      fieldPatterns: SENSITIVE_FIELD_NAMES,
      action: () => '****',
    },
  )
}

function toLogTapeLevel(
  level: LoggingConfigResolved['level'],
): 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal' {
  return level === 'warn' ? 'warning' : level
}

export async function configureLoggingRuntime(input: ConfigureLoggingRuntimeInput): Promise<void> {
  const sinks: Record<string, Sink> = {}

  if (input.logging.sinks.file) {
    await mkdirPath(dirname(input.logging.sinks.file.path), { recursive: true })
  }

  if (input.logging.sinks.console) {
    sinks.console = buildConsoleSink(input)
  }
  if (input.logging.sinks.file) {
    sinks.file = buildFileSink(input)
  }

  await configure({
    reset: true,
    sinks,
    loggers: [
      {
        category: ['logtape', 'meta'],
        sinks: [],
        lowestLevel: 'warning',
      },
      ...(Object.keys(sinks).length === 0
        ? []
        : [
            {
              category: ['knock'],
              sinks: Object.keys(sinks),
              lowestLevel: toLogTapeLevel(input.logging.level),
            },
          ]),
    ],
  })

  configured = true
  setLogTapeRuntimeActive(true)
}

export async function shutdownLoggingRuntime(): Promise<void> {
  if (!configured) return
  await dispose()
  configured = false
  setLogTapeRuntimeActive(false)
}
