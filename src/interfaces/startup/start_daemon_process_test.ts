import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { startDaemonProcess } from './start_daemon_process.ts'

test('[contract] start daemon process: 非 immediate 模式应通过 daemon reload controller 启动', async () => {
  const calls: string[] = []

  await startDaemonProcess(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
    },
    {
      createReloadController: () => ({
        start: async () => {
          calls.push('controller:start')
        },
        stop: async () => {
          calls.push('controller:stop')
        },
      }),
    },
  )

  assertEquals(calls, ['controller:start', 'controller:stop'])
})
