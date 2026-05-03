import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { createDaemonReloadController } from './daemon_reload_controller.ts'
import type { LoadedCompiledConfig } from '../../config/load_compiled_config.ts'

function createLoaded(input: {
  timezone: string
  sqlitePath?: string
  configPath?: string
}): LoadedCompiledConfig {
  return {
    config: {
      runtimeDir: '/tmp/runtime',
      language: 'zh-CN',
      timezone: input.timezone,
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      sqlite: {
        path: input.sqlitePath ?? 'facts.db',
        busyTimeout: '5s',
        journalMode: 'WAL',
        retention: {
          maxAge: '7d',
          maxEntriesPerSource: 100,
          vacuum: 'off',
        },
      },
      deliveries: [],
      sources: [],
      logging: {
        level: 'info',
        sinks: {},
      },
    },
    definitions: {} as never,
    diagnostics: [],
    configPath: input.configPath ?? '/tmp/runtime/config.yml',
    runtimeDir: '/tmp/runtime',
  }
}

function createRuntimeStub(
  label: string,
  calls: string[],
  options: {
    onRunSourceNow?: () => Promise<void>
  } = {},
) {
  return {
    recoverInterruptedAttempts: async () => {
      calls.push(`${label}:recover`)
    },
    runScheduledTick: async () => {
      calls.push(`${label}:scheduled`)
      return { started: true }
    },
    runImmediate: async () => {
      calls.push(`${label}:immediate`)
      return { started: true }
    },
    runSourceNow: async (sourceId: string) => {
      calls.push(`${label}:source:${sourceId}`)
      await options.onRunSourceNow?.()
      return { started: true }
    },
    stop: () => {
      calls.push(`${label}:stop`)
    },
  }
}

test('[contract] daemon reload controller: 合法 reload 后后续 scheduled tick 应使用新 generation，并在 configPath 漂移时重绑 poller', async () => {
  const calls: string[] = []
  const cronTasks: Array<() => Promise<void>> = []
  const pollerConfigPaths: string[] = []
  const loads = [
    createLoaded({ timezone: 'UTC', configPath: '/tmp/runtime/config.yml' }),
    createLoaded({ timezone: 'Asia/Shanghai', configPath: '/tmp/runtime/config.yaml' }),
  ]
  let loadIndex = 0

  const controller = createDaemonReloadController(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      keepAliveSignal: Promise.resolve(),
    },
    {
      loadCompiledConfig: async () => loads[loadIndex++]!,
      createRuntime: ({ loaded }) =>
        createRuntimeStub(loaded.config.timezone, calls) as ReturnType<typeof createRuntimeStub>,
      configureLoggingRuntime: async () => {},
      shutdownLoggingRuntime: async () => {},
      startPoller: ({ configPath }) => {
        pollerConfigPaths.push(configPath)
        return { stop() {}, poll: async () => {} }
      },
      createOuterCron: (task) => {
        cronTasks.push(task)
        return { stop() {} }
      },
    },
  )

  await controller.start()
  await cronTasks[0]?.()
  await controller.requestReload('watcher')
  await cronTasks[1]?.()

  assertEquals(calls, [
    'UTC:recover',
    'UTC:scheduled',
    'UTC:scheduled',
    'UTC:stop',
    'Asia/Shanghai:scheduled',
  ])
  assertEquals(pollerConfigPaths, ['/tmp/runtime/config.yml', '/tmp/runtime/config.yaml'])
})

test('[contract] daemon reload controller: sqlite 变化时应记录需重启告警并保留旧 generation', async () => {
  const calls: string[] = []
  const warnCalls: Array<{ message: string; fields: Record<string, unknown> | undefined }> = []
  const loads = [
    createLoaded({ timezone: 'UTC', sqlitePath: 'facts.db' }),
    createLoaded({ timezone: 'Asia/Shanghai', sqlitePath: 'next.db' }),
  ]
  let loadIndex = 0

  const controller = createDaemonReloadController(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      keepAliveSignal: Promise.resolve(),
    },
    {
      loadCompiledConfig: async () => loads[loadIndex++]!,
      createRuntime: ({ loaded }) =>
        createRuntimeStub(loaded.config.timezone, calls) as ReturnType<typeof createRuntimeStub>,
      configureLoggingRuntime: async () => {},
      shutdownLoggingRuntime: async () => {},
      startPoller: () => ({ stop() {}, poll: async () => {} }),
      createOuterCron: () => ({ stop() {} }),
      logger: {
        error: () => {},
        warn: (message, fields) => {
          warnCalls.push({ message, fields })
        },
      },
    },
  )

  await controller.start()
  await controller.requestReload('watcher')
  await controller.runSourceNow('rust')

  assertEquals(calls, ['UTC:recover', 'UTC:scheduled', 'UTC:source:rust'])
  assertEquals(warnCalls, [
    {
      message: '配置热重载需要重启',
      fields: {
        'config.reload_stage': 'policy',
        'config.reload_reason': 'sqlite',
      },
    },
  ])
})

test('[contract] daemon reload controller: 配置加载失败时应记录错误并保留旧 generation', async () => {
  const calls: string[] = []
  const logCalls: Array<{ message: string; fields: Record<string, unknown> | undefined }> = []
  let loadCount = 0

  const controller = createDaemonReloadController(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      keepAliveSignal: Promise.resolve(),
    },
    {
      loadCompiledConfig: async () => {
        loadCount += 1
        if (loadCount === 1) {
          return createLoaded({ timezone: 'UTC' })
        }
        throw new Error('bad config')
      },
      createRuntime: ({ loaded }) =>
        createRuntimeStub(loaded.config.timezone, calls) as ReturnType<typeof createRuntimeStub>,
      configureLoggingRuntime: async () => {},
      shutdownLoggingRuntime: async () => {},
      startPoller: () => ({ stop() {}, poll: async () => {} }),
      createOuterCron: () => ({ stop() {} }),
      logger: {
        error: (message, fields) => {
          logCalls.push({ message, fields })
        },
        warn: () => {},
      },
    },
  )

  await controller.start()
  await controller.requestReload('watcher')
  await controller.runSourceNow('rust')

  assertEquals(calls, ['UTC:recover', 'UTC:scheduled', 'UTC:source:rust'])
  assertEquals(logCalls, [
    {
      message: '配置热重载失败',
      fields: {
        'config.reload_stage': 'load',
        error_message: 'bad config',
      },
    },
  ])
})

test('[contract] daemon reload controller: reload 过程中 logging 重配失败时应记录错误、回收新 generation 并保留旧 generation', async () => {
  const calls: string[] = []
  const logCalls: Array<{ message: string; fields: Record<string, unknown> | undefined }> = []
  const loads = [createLoaded({ timezone: 'UTC' }), createLoaded({ timezone: 'Asia/Shanghai' })]
  let loadIndex = 0
  let configureCount = 0

  const controller = createDaemonReloadController(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      keepAliveSignal: Promise.resolve(),
    },
    {
      loadCompiledConfig: async () => loads[loadIndex++]!,
      createRuntime: ({ loaded }) =>
        createRuntimeStub(loaded.config.timezone, calls) as ReturnType<typeof createRuntimeStub>,
      configureLoggingRuntime: async () => {
        configureCount += 1
        if (configureCount === 2) {
          throw new Error('logging failed')
        }
      },
      shutdownLoggingRuntime: async () => {},
      startPoller: () => ({ stop() {}, poll: async () => {} }),
      createOuterCron: () => ({ stop() {} }),
      logger: {
        error: (message, fields) => {
          logCalls.push({ message, fields })
        },
        warn: () => {},
      },
    },
  )

  await controller.start()
  await controller.requestReload('watcher')
  await controller.runSourceNow('rust')

  assertEquals(calls, ['UTC:recover', 'UTC:scheduled', 'Asia/Shanghai:stop', 'UTC:source:rust'])
  assertEquals(logCalls, [
    {
      message: '配置热重载失败',
      fields: {
        'config.reload_stage': 'apply_logging',
        error_message: 'logging failed',
      },
    },
  ])
})

test('[contract] daemon reload controller: reload 不应在旧 generation 的 in-flight run 完成前 stop 旧 runtime', async () => {
  const calls: string[] = []
  let finishRun: (() => void) | undefined
  const loads = [createLoaded({ timezone: 'UTC' }), createLoaded({ timezone: 'Asia/Shanghai' })]
  let loadIndex = 0

  const controller = createDaemonReloadController(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      keepAliveSignal: Promise.resolve(),
    },
    {
      loadCompiledConfig: async () => loads[loadIndex++]!,
      createRuntime: ({ loaded }) =>
        createRuntimeStub(loaded.config.timezone, calls, {
          onRunSourceNow:
            loaded.config.timezone === 'UTC'
              ? () =>
                  new Promise<void>((resolve) => {
                    finishRun = () => {
                      calls.push('UTC:finished')
                      resolve()
                    }
                  })
              : undefined,
        }) as ReturnType<typeof createRuntimeStub>,
      configureLoggingRuntime: async () => {},
      shutdownLoggingRuntime: async () => {},
      startPoller: () => ({ stop() {}, poll: async () => {} }),
      createOuterCron: () => ({ stop() {} }),
    },
  )

  await controller.start()
  const runPromise = controller.runSourceNow('rust')
  await controller.requestReload('watcher')
  assertEquals(calls.includes('UTC:stop'), false)
  finishRun?.()
  await runPromise
  assertEquals(calls.includes('UTC:stop'), true)
})
