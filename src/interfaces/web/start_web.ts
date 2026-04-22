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

let currentWebLoggingRuntime: StartWebLoggingRuntime | undefined

export function getCurrentWebLoggingRuntime(): StartWebLoggingRuntime | undefined {
  return currentWebLoggingRuntime
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

export async function startWeb(options: StartWebOptions) {
  const loggingRuntime = await loadStartWebLoggingRuntime()
  setCurrentWebLoggingRuntime(loggingRuntime)
  if (loggingRuntime) {
    await configureLoggingRuntime(loggingRuntime)
  }

  const { default: webApp } = await import('../../../web/main.ts')
  const logger = createLogger({
    enabled: true,
    level: loggingRuntime?.logging.level ?? 'info',
    module: 'web.startup',
    component: 'web',
    timezone: loggingRuntime?.timezone ?? 'UTC',
    timestampFormat: loggingRuntime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
  })

  try {
    await webApp.listen({
      hostname: options.host,
      port: options.port,
      onListen: ({ hostname, port }) => {
        const url = `http://${hostname}:${port}/`
        logger.info(`Web 服务开始监听 ${url}`, {
          'web.operation': 'startup',
          'web.outcome': 'listening',
          'web.host': hostname,
          'web.port': port,
          'web.url': url,
        })
      },
    })
  } finally {
    setCurrentWebLoggingRuntime(undefined)
    await shutdownLoggingRuntime()
  }
}
