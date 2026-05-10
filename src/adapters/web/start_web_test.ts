import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { startWeb, type StartWebLoggingRuntime, type StartWebOptions } from './start_web.ts'

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

test('[contract] start web: controller 应先启动，且 server 启动时应使用 boot 末尾重新读取的 runtime', async () => {
  const calls: string[] = []
  let loadCount = 0

  await startWeb(
    {
      host: '127.0.0.1',
      port: 3000,
    },
    {
      loadRuntimeContext: async () => {
        loadCount += 1
        return loadCount === 1
          ? { configPath: '/tmp/runtime/config.yml', runtime: createRuntime('UTC', 'info') }
          : {
              configPath: '/tmp/runtime/config.yml',
              runtime: createRuntime('Asia/Shanghai', 'debug'),
            }
      },
      createReloadController: () => ({
        start: async (initial) => {
          calls.push(`controller:start:${initial.runtime?.timezone ?? 'none'}`)
        },
        stop: async () => {
          calls.push('controller:stop')
        },
      }),
      ensureWebBuildExists: async () => {
        calls.push('ensure-build')
      },
      loadWebRequestHandler: async () => {
        calls.push('load-handler')
        return async () => new Response('ok')
      },
      runReadyCheckedWebServer: async (
        _options: StartWebOptions,
        runtime: StartWebLoggingRuntime | undefined,
      ) => {
        calls.push(`run-server:${runtime?.timezone ?? 'none'}:${runtime?.logging.level ?? 'none'}`)
      },
    },
  )

  assertEquals(calls, [
    'controller:start:UTC',
    'ensure-build',
    'load-handler',
    'run-server:Asia/Shanghai:debug',
    'controller:stop',
  ])
})

test('[contract] start web: 启动中途失败也应 stop reload controller', async () => {
  const calls: string[] = []

  try {
    await startWeb(
      {
        host: '127.0.0.1',
        port: 3000,
      },
      {
        loadRuntimeContext: async () => ({
          configPath: '/tmp/runtime/config.yml',
          runtime: createRuntime('UTC', 'info'),
        }),
        createReloadController: () => ({
          start: async () => {
            calls.push('controller:start')
          },
          stop: async () => {
            calls.push('controller:stop')
          },
        }),
        ensureWebBuildExists: async () => {
          throw new Error('build failed')
        },
      },
    )
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), 'build failed')
  }

  assertEquals(calls, ['controller:start', 'controller:stop'])
})

test('[contract] start web: controller.start 抛错也应触发 stop 清理', async () => {
  const calls: string[] = []

  try {
    await startWeb(
      {
        host: '127.0.0.1',
        port: 3000,
      },
      {
        loadRuntimeContext: async () => ({
          configPath: '/tmp/runtime/config.yml',
          runtime: createRuntime('UTC', 'info'),
        }),
        createReloadController: () => ({
          start: async () => {
            calls.push('controller:start')
            throw new Error('controller start failed')
          },
          stop: async () => {
            calls.push('controller:stop')
          },
        }),
      },
    )
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), 'controller start failed')
  }

  assertEquals(calls, ['controller:start', 'controller:stop'])
})
