import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { requestConfigReload } from './config_reload_signal.ts'
import { createWebReloadController } from './web_reload_controller.ts'
import type { StartWebLoggingRuntime } from './start_web.ts'

function createRuntime(timezone: string, level: 'info' | 'debug'): StartWebLoggingRuntime {
  return {
    runtimeDir: '/tmp/runtime',
    timezone,
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    logging: {
      level,
      sinks: {},
    },
  }
}

test('[contract] web reload controller: web_save 应重配 logging runtime 并应用新 runtime', async () => {
  const configured: string[] = []
  const applied: string[] = []

  const controller = createWebReloadController({
    loadRuntimeContext: async () => ({
      configPath: '/tmp/runtime/config.yml',
      runtime: createRuntime('Asia/Shanghai', 'debug'),
    }),
    configureLoggingRuntime: async (input) => {
      configured.push(`${input.timezone}:${input.logging.level}`)
    },
    applyRuntime: (runtime) => {
      applied.push(`${runtime?.timezone ?? 'none'}:${runtime?.logging.level ?? 'none'}`)
    },
    startPoller: () => ({ stop() {}, poll: async () => {} }),
  })

  await controller.start({
    configPath: '/tmp/runtime/config.yml',
    runtime: createRuntime('UTC', 'info'),
  })
  await requestConfigReload('web_save')
  await controller.stop()

  assertEquals(configured, ['Asia/Shanghai:debug'])
  assertEquals(applied, ['Asia/Shanghai:debug'])
})

test('[contract] web reload controller: 连续 reload 请求应串行折叠为最后一轮', async () => {
  const configured: string[] = []
  let releaseFirst: (() => void) | undefined
  let loadCount = 0

  const controller = createWebReloadController({
    loadRuntimeContext: async () => {
      loadCount += 1
      return {
        configPath: '/tmp/runtime/config.yml',
        runtime: createRuntime(`TZ-${loadCount}`, 'debug'),
      }
    },
    configureLoggingRuntime: async (input) => {
      configured.push(input.timezone)
      if (input.timezone === 'TZ-1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
    },
    applyRuntime: () => {},
    startPoller: () => ({ stop() {}, poll: async () => {} }),
  })

  await controller.start({
    configPath: '/tmp/runtime/config.yml',
    runtime: createRuntime('UTC', 'info'),
  })

  const first = requestConfigReload('watcher')
  while (!releaseFirst) {
    await Promise.resolve()
  }
  const second = requestConfigReload('web_save')
  releaseFirst()
  await Promise.all([first, second])
  await controller.stop()

  assertEquals(configured, ['TZ-1', 'TZ-2'])
})

test('[contract] web reload controller: start 后应创建针对 configPath 的 poller', async () => {
  const pollerConfigPaths: string[] = []

  const controller = createWebReloadController({
    loadRuntimeContext: async () => ({
      configPath: '/tmp/runtime/config.yml',
      runtime: createRuntime('UTC', 'info'),
    }),
    configureLoggingRuntime: async () => {},
    applyRuntime: () => {},
    startPoller: ({ configPath }) => {
      pollerConfigPaths.push(configPath)
      return {
        stop: () => {},
        poll: async () => {},
      }
    },
  })

  await controller.start({
    configPath: '/tmp/runtime/config.yml',
    runtime: createRuntime('UTC', 'info'),
  })
  await controller.stop()

  assertEquals(pollerConfigPaths, ['/tmp/runtime/config.yml'])
})

test('[contract] web reload controller: stop 后已发出的 reload 完成也不应应用新 runtime', async () => {
  const applied: string[] = []
  let releaseLoad: (() => void) | undefined

  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve
  })

  const controller = createWebReloadController({
    loadRuntimeContext: async () => {
      await loadGate
      return {
        configPath: '/tmp/runtime/config.yml',
        runtime: createRuntime('Asia/Shanghai', 'debug'),
      }
    },
    configureLoggingRuntime: async () => {},
    applyRuntime: (runtime) => {
      applied.push(`${runtime?.timezone ?? 'none'}:${runtime?.logging.level ?? 'none'}`)
    },
    startPoller: () => ({ stop() {}, poll: async () => {} }),
  })

  await controller.start({
    configPath: '/tmp/runtime/config.yml',
    runtime: createRuntime('UTC', 'info'),
  })
  const pending = requestConfigReload('web_save')
  await controller.stop()
  releaseLoad?.()
  await pending

  assertEquals(applied, [])
})
