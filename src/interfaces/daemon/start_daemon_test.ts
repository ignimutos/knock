import { assertEquals } from '@std/assert'
import { startDaemon } from './start_daemon.ts'

Deno.test('startDaemon: 应通过 RunDueSourcesUseCase 驱动 source runs', async () => {
  const calls: string[] = []

  const result = await startDaemon({
    runDueSourcesUseCase: {
      execute: () => {
        calls.push('run-due-sources')
        return Promise.resolve([])
      },
    },
  })

  assertEquals(calls, ['run-due-sources'])
  assertEquals(result.mode, 'daemon')
})
