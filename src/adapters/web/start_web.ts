import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { deleteEnv, getEnv, setEnv } from '../../platform/env.ts'
import { cwd, isNotFoundError, readTextFile, statPath } from '../../platform/fs.ts'
import { spawnSelf } from '../../platform/process.ts'
import { loadConfigRuntimeContext } from '../../config/runtime_config_context.ts'
import { findConfigFile, parseRawConfigDocument } from '../../config/load_config.ts'
import { resolveLoggingConfig } from '../../config/resolve_config.ts'
import { loggingSchema, timezoneSchema } from '../../config/schema.ts'
import type { LoggingConfigResolved } from '../../config/types.ts'
import { createDbClient } from '../../persistence/sqlite/client.ts'
import { parseWithFirstIssue } from '../../zod_utils.ts'
import {
  runReadyCheckedWebServer,
  type StartWebLoggingRuntime,
  type StartWebOptions,
} from './web_startup_runtime.ts'

export type { StartWebLoggingRuntime, StartWebOptions } from './web_startup_runtime.ts'

const WEB_RUNTIME_DIR_ENV = 'KNOCK_WEB_RUNTIME_DIR'
const WEB_TIMEZONE_ENV = 'KNOCK_WEB_TIMEZONE'
const WEB_TIMESTAMP_FORMAT_ENV = 'KNOCK_WEB_TIMESTAMP_FORMAT'
const WEB_LOG_LEVEL_ENV = 'KNOCK_WEB_LOG_LEVEL'
export const SKIP_WEB_RUNTIME_READY_CHECK_ENV = 'KNOCK_SKIP_WEB_RUNTIME_READY_CHECK'
const WEB_READY_PATH = '/config'
const WEB_READY_MARKER = 'Knock Config'
const WEB_READY_TIMEOUT_MS = 90_000
const WEB_CLIENT_ENTRY = '.web-dist/assets/client.js'

function normalizeWebReadyProbeHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::' || host === '[::]') return '::1'
  return host
}

function formatHttpHost(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`
  }
  return host
}

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
  const runtimeDir = getEnv(WEB_RUNTIME_DIR_ENV)
  const timezone = getEnv(WEB_TIMEZONE_ENV)
  const timestampFormat = getEnv(WEB_TIMESTAMP_FORMAT_ENV)
  const level = parseWebLogLevel(getEnv(WEB_LOG_LEVEL_ENV))

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
    deleteEnv(WEB_RUNTIME_DIR_ENV)
    deleteEnv(WEB_TIMEZONE_ENV)
    deleteEnv(WEB_TIMESTAMP_FORMAT_ENV)
    deleteEnv(WEB_LOG_LEVEL_ENV)
    return
  }

  setEnv(WEB_RUNTIME_DIR_ENV, runtime.runtimeDir)
  setEnv(WEB_TIMEZONE_ENV, runtime.timezone)
  setEnv(WEB_TIMESTAMP_FORMAT_ENV, runtime.timestampFormat)
  setEnv(WEB_LOG_LEVEL_ENV, runtime.logging.level)
}

function buildWebChildEnv(): Record<string, string> {
  const next: Record<string, string> = {
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
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
    'npm_config_user_agent',
    'npm_config_cache',
    'DENO_DIR',
    'NODE_OPTIONS',
    'SSL_CERT_FILE',
  ] as const

  for (const key of allowedKeys) {
    const value = getEnv(key)
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
    const value = getEnv(key)
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

export function applyCurrentWebLoggingRuntime(runtime: StartWebLoggingRuntime | undefined): void {
  setCurrentWebLoggingRuntime(runtime)
  applyWebLoggingRuntimeEnv(runtime)
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
  const configPath = getEnv('KNOCK_CONFIG_PATH')
  if (configPath) {
    const resolvedConfigPath = resolve(configPath)
    return {
      runtimeDir: dirname(resolvedConfigPath),
      configPath: resolvedConfigPath,
    }
  }

  return {
    runtimeDir: resolve(getEnv('KNOCK_RUNTIME_DIR') ?? join(cwd(), 'runtime')),
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

export interface LoadedStartWebLoggingRuntimeContext {
  configPath?: string
  runtime: StartWebLoggingRuntime | undefined
}

export async function loadStartWebLoggingRuntimeContext(): Promise<LoadedStartWebLoggingRuntimeContext> {
  const lookup = getStartWebConfigLookup()
  const configPath = await findStartWebConfigPath(lookup.runtimeDir, lookup.configPath)
  if (!configPath) {
    return {
      configPath: undefined,
      runtime: undefined,
    }
  }

  const raw = await readTextFile(configPath)
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
    configPath,
    runtime: {
      runtimeDir: lookup.runtimeDir,
      timezone: config.timezone ?? 'UTC',
      timestampFormat: config.timestampFormat,
      logging: resolveLoggingConfig(lookup.runtimeDir, config.logging),
    },
  }
}

export async function loadStartWebLoggingRuntime(): Promise<StartWebLoggingRuntime | undefined> {
  return (await loadStartWebLoggingRuntimeContext()).runtime
}

function buildWebBuildArgs(): string[] {
  return ['run', 'build:web']
}

async function ensureWebBuildExists(): Promise<void> {
  try {
    await statPath(join(cwd(), WEB_CLIENT_ENTRY))
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  const build = spawnSelf({
    args: buildWebBuildArgs(),
    cwd: cwd(),
    env: buildWebChildEnv(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const status = await build.status
  if (!status.success) {
    throw new Error(`web 生产构建失败: ${status.code}`)
  }
}

export async function assertWebRuntimeReady(): Promise<void> {
  if (getEnv(SKIP_WEB_RUNTIME_READY_CHECK_ENV) === '1') {
    return
  }

  try {
    const context = await loadConfigRuntimeContext({ envMode: 'preserve_unknown' })
    const factsDb = createDbClient({ sqlite: context.loaded.config.sqlite })
    factsDb.$client.close()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Web 启动前检查失败: ${message}`)
  }
}

function createDelay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  return {
    promise: new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, ms)
    }),
    cancel: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
    },
  }
}

function startWebReadyProbe(
  host: string,
  port: number,
  timeoutMs: number,
): { promise: Promise<void>; cancel: () => Promise<void> } {
  const controller = new AbortController()
  const probeHost = formatHttpHost(normalizeWebReadyProbeHost(host))
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const promise = (async () => {
    try {
      const response = await fetch(`http://${probeHost}:${port}${WEB_READY_PATH}`, {
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`unexpected status: ${response.status}`)
      }
      const html = await response.text()
      if (!html.includes(WEB_READY_MARKER)) {
        throw new Error('unexpected ready payload')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          timedOut
            ? `等待 ${WEB_READY_PATH} 就绪探测超时`
            : `等待 ${WEB_READY_PATH} 就绪探测已取消`,
        )
      }
      throw error
    }
  })().finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  })

  return {
    promise,
    cancel: async () => {
      controller.abort()
      await promise.catch(() => {})
    },
  }
}

export async function waitForWebReady(host: string, port: number): Promise<void> {
  const deadline = Date.now() + WEB_READY_TIMEOUT_MS
  let lastError: unknown

  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break

    const probe = startWebReadyProbe(host, port, remainingMs)
    try {
      await probe.promise
      return
    } catch (error) {
      await probe.cancel()
      lastError = error
    }

    const delay = createDelay(Math.min(100, Math.max(0, deadline - Date.now())))
    try {
      await delay.promise
    } finally {
      delay.cancel()
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `等待 Web 服务就绪超时: ${lastError.message}`
      : '等待 Web 服务就绪超时',
  )
}

interface StartWebDeps {
  loadRuntimeContext?: () => Promise<LoadedStartWebLoggingRuntimeContext>
  createReloadController?: () => {
    start(initial: LoadedStartWebLoggingRuntimeContext): Promise<void>
    stop(): Promise<void>
  }
  ensureWebBuildExists?: () => Promise<void>
  loadWebRequestHandler?: () => Promise<(request: Request) => Promise<Response>>
  runReadyCheckedWebServer?: typeof runReadyCheckedWebServer
}

export async function startWeb(options: StartWebOptions, deps: StartWebDeps = {}) {
  const loadRuntimeContext = deps.loadRuntimeContext ?? loadStartWebLoggingRuntimeContext
  const loadedRuntime = await loadRuntimeContext()
  const createReloadController =
    deps.createReloadController ??
    (() => {
      const controllerPromise = import('./web_reload_controller.ts').then(
        ({ createWebReloadController }) => createWebReloadController(),
      )
      return {
        async start(initial: LoadedStartWebLoggingRuntimeContext) {
          const controller = await controllerPromise
          await controller.start(initial)
        },
        async stop() {
          const controller = await controllerPromise
          await controller.stop()
        },
      }
    })
  const reloadController = createReloadController()
  const ensureBuild = deps.ensureWebBuildExists ?? ensureWebBuildExists
  const loadWebRequestHandler =
    deps.loadWebRequestHandler ??
    (async () => {
      const { handleWebRequest } = await import(pathToFileURL(resolve(cwd(), 'web/main.tsx')).href)
      return handleWebRequest
    })
  const runServer = deps.runReadyCheckedWebServer ?? runReadyCheckedWebServer

  try {
    await reloadController.start(loadedRuntime)
    await ensureBuild()
    const handleWebRequest = await loadWebRequestHandler()
    const refreshedRuntime = await loadRuntimeContext()
    await runServer(options, refreshedRuntime.runtime, handleWebRequest, {
      applyRuntime: applyCurrentWebLoggingRuntime,
      assertReady: assertWebRuntimeReady,
      waitForReady: waitForWebReady,
    })
  } finally {
    await reloadController.stop()
  }
}
