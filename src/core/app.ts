import { z } from 'zod'
import type nodemailer from 'nodemailer'
import { loadConfig } from '../config/load_config.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { createDaemonRuntime } from '../interfaces/daemon/create_daemon_runtime.ts'
import { startDaemon } from '../interfaces/daemon/start_daemon.ts'

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

interface StartAppResult {
  mode: 'daemon'
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
  const daemon = createDaemonRuntime({
    config,
    httpFetcher: input.httpFetcher,
    httpProxyClientFactory: input.httpProxyClientFactory,
    emailTransportFactory: input.emailTransportFactory,
    keepAlive: input.keepAlive,
    keepAliveSignal: input.keepAliveSignal,
    immediate: input.immediate,
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
  }
}
