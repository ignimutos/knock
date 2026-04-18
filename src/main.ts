import type nodemailer from 'nodemailer'
import { z } from 'zod'
import { loadConfig } from './config/load_config.ts'
import { createLogger } from './core/logger.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from './core/logging_runtime.ts'
import {
  buildChildArgs,
  parseCliCommand,
  resolveDaemonStartOptions,
  type AllCliCommand,
  type CliCommand,
} from './interfaces/cli/parse_cli_command.ts'
import { createDaemonRuntime } from './interfaces/daemon/create_daemon_runtime.ts'
import { startDaemon } from './interfaces/daemon/start_daemon.ts'
import { parseWithFirstIssue } from './zod_utils.ts'

export interface StartAppOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

interface StartAppInput {
  runtimeDir?: string
  configPath?: string
  httpFetcher: typeof fetch
  httpProxyClientFactory: typeof Deno.createHttpClient
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
  startWeb?: (options: { host: string; port: number }) => Promise<void>
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
  httpProxyClientFactory: z.custom<typeof Deno.createHttpClient>(
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
    httpProxyClientFactory: parsed.httpProxyClientFactory ?? Deno.createHttpClient,
    emailTransportFactory: parsed.emailTransportFactory,
    keepAlive: parsed.keepAlive ?? true,
    keepAliveSignal: parsed.keepAliveSignal,
    immediate: parsed.immediate ?? false,
  }
}

export async function startApp(options: StartAppOptions = {}): Promise<StartAppResult> {
  const input = normalizeStartAppInput(options)
  const config = await loadConfig({
    runtimeDir: input.runtimeDir,
    configPath: input.configPath,
  })

  await configureLoggingRuntime({
    logging: config.logging,
    runtimeDir: config.runtimeDir,
    timezone: config.timezone,
    timestampFormat: config.timestampFormat,
  })

  const daemon = createDaemonRuntime({
    config,
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

export async function startWeb(options: { host: string; port: number }) {
  const { default: webApp } = await import('../web/main.ts')
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'web.startup',
    component: 'web',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
  })

  await webApp.listen({
    hostname: options.host,
    port: options.port,
    onListen: ({ hostname, port }) => {
      logger.info('Web 服务开始监听', {
        'web.operation': 'startup',
        'web.outcome': 'listening',
        'web.host': hostname,
        'web.port': port,
        'web.url': `http://${hostname}:${port}/`,
      })
    },
  })
}

export async function runAllModes(command: AllCliCommand): Promise<void> {
  const daemonChild = new Deno.Command(Deno.execPath(), {
    args: buildChildArgs(command, 'daemon'),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  const webChild = new Deno.Command(Deno.execPath(), {
    args: buildChildArgs(command, 'web'),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

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
  await main(Deno.args)
}
