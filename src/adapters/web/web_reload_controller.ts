import { createConfigFilePoller, type ConfigFilePoller } from '../../config/config_file_poller.ts'
import { configureLoggingRuntime } from '../../core/logging_runtime.ts'
import {
  applyCurrentWebLoggingRuntime,
  loadStartWebLoggingRuntimeContext,
  type LoadedStartWebLoggingRuntimeContext,
  type StartWebLoggingRuntime,
} from './start_web.ts'
import { setConfigReloadRequester, type ConfigReloadTrigger } from './config_reload_signal.ts'

interface CreateWebReloadControllerDeps {
  loadRuntimeContext?: () => Promise<LoadedStartWebLoggingRuntimeContext>
  configureLoggingRuntime?: typeof configureLoggingRuntime
  applyRuntime?: (runtime: StartWebLoggingRuntime | undefined) => void
  startPoller?: (input: { configPath: string; onChange: () => Promise<void> }) => ConfigFilePoller
}

interface WebReloadController {
  start(initial: LoadedStartWebLoggingRuntimeContext): Promise<void>
  stop(): Promise<void>
}

export function createWebReloadController(
  deps: CreateWebReloadControllerDeps = {},
): WebReloadController {
  const loadRuntimeContext = deps.loadRuntimeContext ?? loadStartWebLoggingRuntimeContext
  const configureLogging = deps.configureLoggingRuntime ?? configureLoggingRuntime
  const applyRuntime = deps.applyRuntime ?? applyCurrentWebLoggingRuntime
  const startPoller =
    deps.startPoller ??
    ((input) =>
      createConfigFilePoller({
        configPath: input.configPath,
        onChange: input.onChange,
      }))

  let currentConfigPath: string | undefined
  let poller: ConfigFilePoller | undefined
  let pendingTrigger = false
  let reloadPromise: Promise<void> | undefined
  let stopped = false

  function restartPoller(configPath: string): void {
    poller?.stop()
    currentConfigPath = configPath
    poller = startPoller({
      configPath,
      onChange: async () => {
        await requestReload('watcher')
      },
    })
  }

  async function reloadOnce(): Promise<void> {
    if (stopped) {
      return
    }

    const loaded = await loadRuntimeContext()
    if (stopped || !loaded.runtime || !loaded.configPath) {
      return
    }

    await configureLogging(loaded.runtime)
    if (stopped) {
      return
    }
    applyRuntime(loaded.runtime)

    if (loaded.configPath !== currentConfigPath) {
      restartPoller(loaded.configPath)
    }
  }

  async function requestReload(_trigger: ConfigReloadTrigger): Promise<void> {
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
    async start(initial: LoadedStartWebLoggingRuntimeContext): Promise<void> {
      stopped = false
      setConfigReloadRequester(requestReload)
      if (initial.configPath) {
        restartPoller(initial.configPath)
      }
    },
    async stop(): Promise<void> {
      stopped = true
      poller?.stop()
      poller = undefined
      currentConfigPath = undefined
      setConfigReloadRequester(undefined)
    },
  }
}
