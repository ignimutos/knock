import { z } from 'zod'
import type { CreateTransport } from '../../platform/nodemailer.ts'
import type { Fetcher, ProxyClientFactory } from '../../core/http_client.ts'
import { loadCompiledConfig } from '../../config/load_compiled_config.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from '../../core/logging_runtime.ts'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'
import { startDaemon } from '../daemon/start_daemon.ts'
import { parseWithFirstIssue } from '../../zod_utils.ts'

export interface StartDaemonProcessOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

interface StartDaemonProcessInput {
  runtimeDir?: string
  configPath?: string
  httpFetcher: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  keepAlive: boolean
  keepAliveSignal?: Promise<void>
  immediate: boolean
}

export interface StartDaemonProcessResult {
  mode: 'daemon'
}

const startDaemonProcessOptionsSchema = z.object({
  runtimeDir: z.string({ message: 'runtimeDir 必须是字符串' }).optional(),
  configPath: z.string({ message: 'configPath 必须是字符串' }).optional(),
  httpFetcher: z.custom<Fetcher>((value) => value === undefined || typeof value === 'function', {
    message: 'httpFetcher 必须是函数',
  }),
  httpProxyClientFactory: z.custom<ProxyClientFactory>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'httpProxyClientFactory 必须是函数' },
  ),
  emailTransportFactory: z.custom<CreateTransport>(
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

function normalizeStartDaemonProcessInput(
  options: StartDaemonProcessOptions = {},
): StartDaemonProcessInput {
  const parsed = parseWithFirstIssue(startDaemonProcessOptionsSchema, options, 'startApp 参数非法')

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

export async function startDaemonProcess(
  options: StartDaemonProcessOptions = {},
): Promise<StartDaemonProcessResult> {
  const input = normalizeStartDaemonProcessInput(options)
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
