import { Cron } from 'croner'
import {
  classifyReloadTransition,
  type ConfigReloadTransition,
} from '../config/config_reload_policy.ts'
import { createConfigFilePoller, type ConfigFilePoller } from '../config/config_file_poller.ts'
import {
  loadCompiledConfig,
  type LoadCompiledConfigOptions,
  type LoadedCompiledConfig,
} from '../config/load_compiled_config.ts'
import {
  createProductionRuntime,
  type ProductionRuntime,
} from './create_production_runtime.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from '../core/logging_runtime.ts'
import { createLogger, type Logger } from '../core/logger.ts'
import type { Fetcher, ProxyClientFactory } from '../core/http_client.ts'
import type { CreateTransport } from '../platform/nodemailer.ts'

export type DaemonReloadTrigger = 'watcher'

interface ActiveGeneration {
  loaded: LoadedCompiledConfig
  runtime: Pick<
    ProductionRuntime,
    'recoverInterruptedAttempts' | 'runScheduledTick' | 'runSourceNow' | 'stop'
  >
  acceptingRuns: boolean
  inFlightRuns: number
}

export interface CreateDaemonReloadControllerOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
}

interface DaemonReloadController {
  start(): Promise<void>
  stop(): Promise<void>
  requestReload(trigger: DaemonReloadTrigger): Promise<void>
  runSourceNow(sourceId: string): Promise<{ started: boolean }>
}

interface CreateDaemonReloadControllerDeps {
  loadCompiledConfig?: (options: LoadCompiledConfigOptions) => Promise<LoadedCompiledConfig>
  createRuntime?: (input: { loaded: LoadedCompiledConfig }) => ActiveGeneration['runtime']
  configureLoggingRuntime?: typeof configureLoggingRuntime
  shutdownLoggingRuntime?: typeof shutdownLoggingRuntime
  startPoller?: (input: { configPath: string; onChange: () => Promise<void> }) => ConfigFilePoller
  createOuterCron?: (task: () => Promise<void>, timezone: string) => { stop(): void }
  logger?: Pick<Logger, 'error' | 'warn'>
}

function createRuntimeGeneration(
  options: CreateDaemonReloadControllerOptions,
  deps: CreateDaemonReloadControllerDeps,
  loaded: LoadedCompiledConfig,
): ActiveGeneration {
  const runtime =
    deps.createRuntime?.({ loaded }) ??
    createProductionRuntime({
      config: loaded.config,
      definitions: loaded.definitions,
      httpFetcher: options.httpFetcher,
      httpProxyClientFactory: options.httpProxyClientFactory,
      emailTransportFactory: options.emailTransportFactory,
      keepAlive: false,
    })

  return {
    loaded,
    runtime,
    acceptingRuns: true,
    inFlightRuns: 0,
  }
}

export function createDaemonReloadController(
  options: CreateDaemonReloadControllerOptions,
  deps: CreateDaemonReloadControllerDeps = {},
): DaemonReloadController {
  const loadCompiled = deps.loadCompiledConfig ?? loadCompiledConfig
  const configureLogging = deps.configureLoggingRuntime ?? configureLoggingRuntime
  const shutdownLogging = deps.shutdownLoggingRuntime ?? shutdownLoggingRuntime
  const startPoller =
    deps.startPoller ??
    ((input) =>
      createConfigFilePoller({
        configPath: input.configPath,
        onChange: input.onChange,
      }))
  const createOuterCron =
    deps.createOuterCron ??
    ((task, timezone) => new Cron('* * * * * *', { protect: true, timezone }, task))
  const logger =
    deps.logger ??
    createLogger({
      enabled: true,
      level: 'error',
      module: 'app.reload.daemon',
      component: 'daemon',
    })

  let activeGeneration: ActiveGeneration | undefined
  let poller: ConfigFilePoller | undefined
  let currentConfigPath: string | undefined
  let outerCron: { stop(): void } | undefined
  let pendingTrigger = false
  let reloadPromise: Promise<void> | undefined

  function restartOuterCron(): void {
    outerCron?.stop()
    if (!activeGeneration) return
    outerCron = createOuterCron(async () => {
      await withActiveGeneration((generation) => generation.runtime.runScheduledTick())
    }, activeGeneration.loaded.config.timezone)
  }

  function restartPoller(configPath: string): void {
    poller?.stop()
    currentConfigPath = configPath
    poller = startPoller({
      configPath,
      onChange: async () => {
        await requestReload()
      },
    })
  }

  async function disposeGenerationIfIdle(generation: ActiveGeneration): Promise<void> {
    if (generation.acceptingRuns || generation.inFlightRuns > 0) {
      return
    }
    generation.runtime.stop()
  }

  async function withActiveGeneration<T>(
    run: (generation: ActiveGeneration) => Promise<T>,
  ): Promise<T> {
    const generation = activeGeneration
    if (!generation) {
      throw new Error('daemon reload controller 未初始化')
    }

    generation.inFlightRuns += 1
    try {
      return await run(generation)
    } finally {
      generation.inFlightRuns -= 1
      await disposeGenerationIfIdle(generation)
    }
  }

  async function loadNextGeneration(): Promise<LoadedCompiledConfig> {
    return await loadCompiled({
      runtimeDir: options.runtimeDir,
      configPath: options.configPath,
    })
  }

  async function applyLogging(loaded: LoadedCompiledConfig): Promise<void> {
    await configureLogging({
      logging: loaded.config.logging,
      runtimeDir: loaded.config.runtimeDir,
      timezone: loaded.config.timezone,
      timestampFormat: loaded.config.timestampFormat,
    })
  }

  async function reloadOnce(): Promise<void> {
    const previous = activeGeneration
    if (!previous) return

    let loaded: LoadedCompiledConfig
    try {
      loaded = await loadNextGeneration()
    } catch (error) {
      logger.error('配置热重载失败', {
        'config.reload_stage': 'load',
        error_message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const decision: ConfigReloadTransition = classifyReloadTransition(
      previous.loaded.config,
      loaded.config,
    )
    if (decision.kind === 'requires_restart') {
      logger.warn('配置热重载需要重启', {
        'config.reload_stage': 'policy',
        'config.reload_reason': decision.reason,
      })
      return
    }

    const next = createRuntimeGeneration(options, deps, loaded)

    try {
      await applyLogging(loaded)
    } catch (error) {
      next.acceptingRuns = false
      next.runtime.stop()
      logger.error('配置热重载失败', {
        'config.reload_stage': 'apply_logging',
        error_message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    activeGeneration = next
    restartOuterCron()
    if (loaded.configPath !== currentConfigPath) {
      restartPoller(loaded.configPath)
    }
    previous.acceptingRuns = false
    await disposeGenerationIfIdle(previous)
  }

  async function requestReload(): Promise<void> {
    pendingTrigger = true
    if (reloadPromise) {
      await reloadPromise
      return
    }

    reloadPromise = (async () => {
      while (pendingTrigger) {
        pendingTrigger = false
        await reloadOnce()
      }
    })()

    try {
      await reloadPromise
    } finally {
      reloadPromise = undefined
    }
  }

  return {
    async start(): Promise<void> {
      const loaded = await loadNextGeneration()
      await applyLogging(loaded)
      activeGeneration = createRuntimeGeneration(options, deps, loaded)
      await activeGeneration.runtime.recoverInterruptedAttempts()
      await activeGeneration.runtime.runScheduledTick()
      restartOuterCron()
      restartPoller(loaded.configPath)

      if (options.keepAlive ?? true) {
        await (options.keepAliveSignal ?? new Promise(() => {}))
      }
    },
    async stop(): Promise<void> {
      poller?.stop()
      outerCron?.stop()
      poller = undefined
      currentConfigPath = undefined
      outerCron = undefined

      const generation = activeGeneration
      activeGeneration = undefined
      if (generation) {
        generation.acceptingRuns = false
        generation.runtime.stop()
      }

      await shutdownLogging()
    },
    async requestReload(_trigger: DaemonReloadTrigger): Promise<void> {
      await requestReload()
    },
    async runSourceNow(sourceId: string): Promise<{ started: boolean }> {
      return await withActiveGeneration((generation) => generation.runtime.runSourceNow(sourceId))
    },
  }
}
