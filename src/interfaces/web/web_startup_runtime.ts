import type { LoggingConfigResolved } from '../../config/types.ts'
import { createLogger } from '../../core/logger.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from '../../core/logging_runtime.ts'
import { isAddrInUseError, serve } from '../../platform/serve.ts'

export interface StartWebLoggingRuntime {
  runtimeDir: string
  timezone: string
  timestampFormat: string
  logging: LoggingConfigResolved
}

export interface StartWebOptions {
  host: string
  port: number
}

export interface RunReadyCheckedWebServerHooks {
  applyRuntime: (runtime: StartWebLoggingRuntime | undefined) => void
  assertReady: () => Promise<void>
  waitForReady: (host: string, port: number) => Promise<void>
}

export async function runReadyCheckedWebServer(
  options: StartWebOptions,
  runtime: StartWebLoggingRuntime | undefined,
  handleWebRequest: (request: Request) => Promise<Response>,
  hooks: RunReadyCheckedWebServerHooks,
): Promise<void> {
  hooks.applyRuntime(runtime)
  if (runtime) {
    await configureLoggingRuntime(runtime)
  }

  const logger = createLogger({
    enabled: true,
    level: runtime?.logging.level ?? 'info',
    module: 'web.startup',
    component: 'web',
    timezone: runtime?.timezone ?? 'UTC',
    timestampFormat: runtime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
  })

  let server: ReturnType<typeof serve> | undefined
  const abortController = new AbortController()

  try {
    await hooks.assertReady()
    server = serve(
      {
        hostname: options.host,
        port: options.port,
        signal: abortController.signal,
      },
      (request) => handleWebRequest(request),
    )

    const url = `http://${options.host}:${options.port}/`
    await hooks.waitForReady(options.host, options.port)
    logger.info(`Web 服务开始监听 ${url}`, {
      'web.operation': 'startup',
      'web.outcome': 'listening',
      'web.host': options.host,
      'web.port': options.port,
      'web.url': url,
    })
    await server.finished
  } catch (error) {
    if (isAddrInUseError(error)) {
      throw new Error('web 子进程异常退出: 1')
    }
    throw error
  } finally {
    if (server) {
      abortController.abort()
      try {
        await server.shutdown()
      } catch {
        // noop
      }
    }
    hooks.applyRuntime(undefined)
    await shutdownLoggingRuntime()
  }
}
