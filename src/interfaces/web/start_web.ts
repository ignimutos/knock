import { dirname, join, resolve } from '@std/path'
import { z } from 'zod'
import { findConfigFile, parseRawConfigDocument } from '../../config/load_config.ts'
import { resolveLoggingConfig } from '../../config/resolve_config.ts'
import { loggingSchema, timezoneSchema } from '../../config/schema.ts'
import type { LoggingConfigResolved } from '../../config/types.ts'
import { createLogger } from '../../core/logger.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from '../../core/logging_runtime.ts'
import { parseWithFirstIssue } from '../../zod_utils.ts'

export interface StartWebLoggingRuntime {
  runtimeDir: string
  timezone: string
  timestampFormat: string
  logging: LoggingConfigResolved
}

const WEB_RUNTIME_DIR_ENV = 'KNOCK_WEB_RUNTIME_DIR'
const WEB_TIMEZONE_ENV = 'KNOCK_WEB_TIMEZONE'
const WEB_TIMESTAMP_FORMAT_ENV = 'KNOCK_WEB_TIMESTAMP_FORMAT'
const WEB_LOG_LEVEL_ENV = 'KNOCK_WEB_LOG_LEVEL'

let currentWebLoggingRuntime: StartWebLoggingRuntime | undefined

function parseWebLogLevel(value: string | undefined): LoggingConfigResolved['level'] | undefined {
  if (
    value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal'
  ) {
    return value
  }
  return undefined
}

function readWebLoggingRuntimeFromEnv(): StartWebLoggingRuntime | undefined {
  const runtimeDir = Deno.env.get(WEB_RUNTIME_DIR_ENV)
  const timezone = Deno.env.get(WEB_TIMEZONE_ENV)
  const timestampFormat = Deno.env.get(WEB_TIMESTAMP_FORMAT_ENV)
  const level = parseWebLogLevel(Deno.env.get(WEB_LOG_LEVEL_ENV))

  if (!runtimeDir || !timezone || !timestampFormat || !level) {
    return undefined
  }

  return {
    runtimeDir,
    timezone,
    timestampFormat,
    logging: {
      level,
      sinks: {},
    },
  }
}

function applyWebLoggingRuntimeEnv(runtime: StartWebLoggingRuntime | undefined): void {
  if (!runtime) {
    Deno.env.delete(WEB_RUNTIME_DIR_ENV)
    Deno.env.delete(WEB_TIMEZONE_ENV)
    Deno.env.delete(WEB_TIMESTAMP_FORMAT_ENV)
    Deno.env.delete(WEB_LOG_LEVEL_ENV)
    return
  }

  Deno.env.set(WEB_RUNTIME_DIR_ENV, runtime.runtimeDir)
  Deno.env.set(WEB_TIMEZONE_ENV, runtime.timezone)
  Deno.env.set(WEB_TIMESTAMP_FORMAT_ENV, runtime.timestampFormat)
  Deno.env.set(WEB_LOG_LEVEL_ENV, runtime.logging.level)
}

function buildViteChildEnv(): Record<string, string> {
  const next: Record<string, string> = {}
  const allowedKeys = [
    'HOME',
    'PATH',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'COMSPEC',
    'PATHEXT',
    'TERM',
    'NO_COLOR',
    'FORCE_COLOR',
    'CI',
    'npm_config_user_agent',
    'npm_config_cache',
    'DENO_DIR',
    'NODE_OPTIONS',
    'SSL_CERT_FILE',
  ] as const

  for (const key of allowedKeys) {
    const value = Deno.env.get(key)
    if (value !== undefined) {
      next[key] = value
    }
  }

  for (const key of [
    'KNOCK_CONFIG_PATH',
    'KNOCK_RUNTIME_DIR',
    WEB_RUNTIME_DIR_ENV,
    WEB_TIMEZONE_ENV,
    WEB_TIMESTAMP_FORMAT_ENV,
    WEB_LOG_LEVEL_ENV,
  ]) {
    const value = Deno.env.get(key)
    if (value !== undefined) {
      next[key] = value
    }
  }

  return next
}

export function getCurrentWebLoggingRuntime(): StartWebLoggingRuntime | undefined {
  return currentWebLoggingRuntime ?? readWebLoggingRuntimeFromEnv()
}

export function setCurrentWebLoggingRuntime(runtime: StartWebLoggingRuntime | undefined): void {
  currentWebLoggingRuntime = runtime
}

export interface StartWebOptions {
  host: string
  port: number
}

const webLoggingConfigSchema = z.object({
  timezone: timezoneSchema.optional(),
  timestampFormat: z.string().default('yyyy-MM-dd HH:mm:ss'),
  logging: loggingSchema,
})

function getStartWebConfigLookup(): {
  runtimeDir: string
  configPath?: string
} {
  const configPath = Deno.env.get('KNOCK_CONFIG_PATH')
  if (configPath) {
    const resolvedConfigPath = resolve(configPath)
    return {
      runtimeDir: dirname(resolvedConfigPath),
      configPath: resolvedConfigPath,
    }
  }

  return {
    runtimeDir: resolve(Deno.env.get('KNOCK_RUNTIME_DIR') ?? join(Deno.cwd(), 'runtime')),
  }
}

async function findStartWebConfigPath(
  runtimeDir: string,
  configPath?: string,
): Promise<string | undefined> {
  if (configPath) return configPath

  try {
    return await findConfigFile(runtimeDir)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        `配置文件不存在: ${join(runtimeDir, 'config.yml')} 或 ${join(runtimeDir, 'config.yaml')}`
    ) {
      return undefined
    }
    throw error
  }
}

function assertNoEnvExpansion(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.includes('${')) {
      throw new Error(`${path} 不支持环境变量展开`)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoEnvExpansion(item, `${path}[${index}]`))
    return
  }

  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    assertNoEnvExpansion(child, `${path}.${key}`)
  }
}

async function loadStartWebLoggingRuntime(): Promise<StartWebLoggingRuntime | undefined> {
  const lookup = getStartWebConfigLookup()
  const configPath = await findStartWebConfigPath(lookup.runtimeDir, lookup.configPath)
  if (!configPath) return undefined

  const raw = await Deno.readTextFile(configPath)
  const parsed = parseRawConfigDocument(raw)

  assertNoEnvExpansion(parsed.timezone, 'timezone')
  assertNoEnvExpansion(parsed.timestampFormat, 'timestampFormat')
  assertNoEnvExpansion(parsed.logging, 'logging')

  const config = parseWithFirstIssue(
    webLoggingConfigSchema,
    {
      timezone: parsed.timezone,
      timestampFormat: parsed.timestampFormat,
      logging: parsed.logging,
    },
    'web logging 配置非法',
  )

  return {
    runtimeDir: lookup.runtimeDir,
    timezone: config.timezone ?? 'UTC',
    timestampFormat: config.timestampFormat,
    logging: resolveLoggingConfig(lookup.runtimeDir, config.logging),
  }
}

async function waitForChildExit(child: Deno.ChildProcess): Promise<void> {
  const status = await child.status
  if (!status.success && status.code !== 143) {
    throw new Error(`web 子进程异常退出: ${status.code}`)
  }
}

export async function startWeb(options: StartWebOptions) {
  const loggingRuntime = await loadStartWebLoggingRuntime()
  setCurrentWebLoggingRuntime(loggingRuntime)
  applyWebLoggingRuntimeEnv(loggingRuntime)
  if (loggingRuntime) {
    await configureLoggingRuntime(loggingRuntime)
  }

  const logger = createLogger({
    enabled: true,
    level: loggingRuntime?.logging.level ?? 'info',
    module: 'web.startup',
    component: 'web',
    timezone: loggingRuntime?.timezone ?? 'UTC',
    timestampFormat: loggingRuntime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
  })

  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', 'npm:vite', '--host', options.host, '--port', String(options.port)],
    cwd: Deno.cwd(),
    env: buildViteChildEnv(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  try {
    const url = `http://${options.host}:${options.port}/`
    logger.info(`Web 服务开始监听 ${url}`, {
      'web.operation': 'startup',
      'web.outcome': 'listening',
      'web.host': options.host,
      'web.port': options.port,
      'web.url': url,
    })
    await waitForChildExit(child)
  } finally {
    try {
      child.kill('SIGTERM')
    } catch {
      // noop
    }
    setCurrentWebLoggingRuntime(undefined)
    applyWebLoggingRuntimeEnv(undefined)
    await shutdownLoggingRuntime()
  }
}
