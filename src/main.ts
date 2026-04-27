import { fromFileUrl } from '@std/path'
import type nodemailer from 'nodemailer'
import { z } from 'zod'
import type { ProxyClientFactory } from './core/http_client.ts'
import { getEnvObject } from './platform/env.ts'
import { execPath, getArgs, spawnSelf } from './platform/process.ts'
import { loadCompiledConfig } from './config/load_compiled_config.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from './core/logging_runtime.ts'
import {
  buildChildArgs,
  parseCliCommand,
  resolveDaemonStartOptions,
  type AllCliCommand,
  type CliCommand,
} from './interfaces/cli/parse_cli_command.ts'
import { createProductionRuntime } from './composition/create_production_runtime.ts'
import { startDaemon } from './interfaces/daemon/start_daemon.ts'
import {
  SKIP_WEB_RUNTIME_READY_CHECK_ENV,
  startWeb as startWebImpl,
  type StartWebOptions,
} from './interfaces/web/start_web.ts'
import { parseWithFirstIssue } from './zod_utils.ts'

export const startWeb = startWebImpl

export interface StartAppOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

interface StartAppInput {
  runtimeDir?: string
  configPath?: string
  httpFetcher: typeof fetch
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive: boolean
  keepAliveSignal?: Promise<void>
  immediate: boolean
}

export interface StartAppResult {
  mode: 'daemon'
}

export interface DispatchCliCommandDeps {
  startApp?: (options: StartAppOptions) => Promise<StartAppResult>
  startWeb?: (options: StartWebOptions) => Promise<void>
  runAllModes?: (command: AllCliCommand) => Promise<void>
  env?: Record<string, string | undefined>
}

const startAppOptionsSchema = z.object({
  runtimeDir: z.string({ message: 'runtimeDir 必须是字符串' }).optional(),
  configPath: z.string({ message: 'configPath 必须是字符串' }).optional(),
  httpFetcher: z.custom<typeof fetch>(
    (value) => value === undefined || typeof value === 'function',
    {
      message: 'httpFetcher 必须是函数',
    },
  ),
  httpProxyClientFactory: z.custom<ProxyClientFactory>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'httpProxyClientFactory 必须是函数' },
  ),
  emailTransportFactory: z.custom<typeof nodemailer.createTransport>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'emailTransportFactory 必须是函数' },
  ),
  keepAlive: z.boolean({ message: 'keepAlive 必须是布尔值' }).optional(),
  keepAliveSignal: z.custom<Promise<void>>(
    (value) => value === undefined || value instanceof Promise,
    { message: 'keepAliveSignal 必须是 Promise' },
  ),
  immediate: z.boolean({ message: 'immediate 必须是布尔值' }).optional(),
})

function normalizeStartAppInput(options: StartAppOptions = {}): StartAppInput {
  const parsed = parseWithFirstIssue(startAppOptionsSchema, options, 'startApp 参数非法')

  return {
    runtimeDir: parsed.runtimeDir,
    configPath: parsed.configPath,
    httpFetcher: parsed.httpFetcher ?? fetch,
    httpProxyClientFactory: parsed.httpProxyClientFactory,
    emailTransportFactory: parsed.emailTransportFactory,
    keepAlive: parsed.keepAlive ?? true,
    keepAliveSignal: parsed.keepAliveSignal,
    immediate: parsed.immediate ?? false,
  }
}

export async function startApp(options: StartAppOptions = {}): Promise<StartAppResult> {
  const input = normalizeStartAppInput(options)
  const loaded = await loadCompiledConfig({
    runtimeDir: input.runtimeDir,
    configPath: input.configPath,
  })
  const { config, definitions } = loaded

  await configureLoggingRuntime({
    logging: config.logging,
    runtimeDir: config.runtimeDir,
    timezone: config.timezone,
    timestampFormat: config.timestampFormat,
  })

  const daemon = createProductionRuntime({
    config,
    definitions,
    httpFetcher: input.httpFetcher,
    httpProxyClientFactory: input.httpProxyClientFactory,
    emailTransportFactory: input.emailTransportFactory,
    keepAlive: input.keepAlive,
    keepAliveSignal: input.keepAliveSignal,
  })

  try {
    await daemon.recoverInterruptedAttempts()

    if (input.immediate) {
      await daemon.runImmediate()
      return { mode: 'daemon' }
    }

    await startDaemon({
      runDueSourcesUseCase: daemon.runDueSourcesUseCase,
      recoverInterruptedAttempts: async () => {},
    })
    await daemon.enterDaemon()
    return { mode: 'daemon' }
  } finally {
    daemon.stop()
    await shutdownLoggingRuntime()
  }
}

function buildSelfCommandArgs(args: string[]): string[] {
  if (/([/\\]|^)deno(?:\.exe)?$/i.test(execPath())) {
    return [
      'run',
      '--allow-all',
      '--cached-only',
      '--node-modules-dir=none',
      fromFileUrl(Deno.mainModule),
      ...args,
    ]
  }

  return [fromFileUrl(import.meta.url), ...args]
}

export async function runAllModes(command: AllCliCommand): Promise<void> {
  const childEnv = {
    ...getEnvObject(),
    ...(command.configPath ? { KNOCK_CONFIG_PATH: command.configPath } : {}),
    ...(command.runtimeDir ? { KNOCK_RUNTIME_DIR: command.runtimeDir } : {}),
  }

  const daemonChild = spawnSelf({
    args: buildSelfCommandArgs(buildChildArgs(command, 'daemon')),
    env: childEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const webChild = spawnSelf({
    args: buildSelfCommandArgs(buildChildArgs(command, 'web')),
    env: {
      ...childEnv,
      [SKIP_WEB_RUNTIME_READY_CHECK_ENV]: '1',
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const firstExit = await Promise.race([
    daemonChild.status.then((status) => ({ name: 'daemon', status })),
    webChild.status.then((status) => ({ name: 'web', status })),
  ])

  if (firstExit.name === 'daemon') {
    try {
      webChild.kill('SIGTERM')
    } catch {
      // noop
    }
  } else {
    try {
      daemonChild.kill('SIGTERM')
    } catch {
      // noop
    }
  }

  await Promise.allSettled([daemonChild.status, webChild.status])

  if (!firstExit.status.success) {
    throw new Error(`${firstExit.name} 子进程异常退出: ${firstExit.status.code}`)
  }
}

export async function dispatchCliCommand(
  command: CliCommand,
  deps: DispatchCliCommandDeps = {},
): Promise<void> {
  const startAppFn = deps.startApp ?? startApp
  const startWebFn = deps.startWeb ?? startWeb
  const runAllModesFn = deps.runAllModes ?? runAllModes

  if (command.kind === 'daemon') {
    await startAppFn(resolveDaemonStartOptions(command, deps.env))
    return
  }

  if (command.kind === 'web') {
    await startWebFn({
      host: command.host,
      port: command.port,
    })
    return
  }

  await runAllModesFn(command)
}

export async function main(args: string[], deps: DispatchCliCommandDeps = {}): Promise<void> {
  await dispatchCliCommand(parseCliCommand(args), deps)
}

if (import.meta.main) {
  await main(getArgs())
}
