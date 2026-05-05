import { assert, assertEquals } from '../../testing/assert.ts'
import { join } from 'node:path'
import { withOwnedRuntime } from '../../test_runtime.ts'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'
import { startDaemon } from './start_daemon.ts'
import { test } from '../../testing/test_api.ts'

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

test('[flow] R15 startDaemon: 应通过 RunDueSourcesUseCase 驱动 source runs', async () => {
  const calls: string[] = []

  const result = await startDaemon({
    runDueSourcesUseCase: {
      execute: (command) => {
        calls.push(`${command.trigger}:${command.sourceId ?? 'all'}`)
        return Promise.resolve([])
      },
    },
  })

  assertEquals(calls, ['scheduled:all'])
  assertEquals(result.mode, 'daemon')
})

test('[contract] daemon logger: emitted attributes 不应包含 app.runtime_dir', async () => {
  const output: string[] = []
  const consoleProxy = console as unknown as {
    log: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  const originalConsole = {
    log: consoleProxy.log,
    warn: consoleProxy.warn,
    error: consoleProxy.error,
  }

  try {
    const capture = (...args: unknown[]) => {
      output.push(args.map((arg) => String(arg)).join(' '))
    }
    consoleProxy.log = capture
    consoleProxy.warn = capture
    consoleProxy.error = capture

    await withOwnedRuntime(({ runtimeDir }) => {
      const daemon = createProductionRuntime({
        config: {
          runtimeDir,
          language: 'zh-CN',
          timezone: 'UTC',
          timestampFormat: 'yyyy-MM-dd HH:mm:ss',
          sqlite: {
            path: join(runtimeDir, 'facts.db'),
            busyTimeout: '5s',
            journalMode: 'WAL',
            retention: {
              maxAge: '180d',
              maxEntriesPerSource: 1000,
              vacuum: 'off',
            },
          },
          deliveries: [],
          sources: [],
          logging: {
            level: 'info',
            sinks: {
              console: {
                type: 'console',
                format: 'jsonl',
              },
            },
          },
        },
        keepAlive: false,
      })

      daemon.stop()
    })

    const records = output
      .map(parseRecord)
      .filter((record): record is Record<string, unknown> => record !== null)

    assert(records.length > 0)

    const hasRuntimeDirAttribute = records.some((record) => {
      const attributes = (record.attributes ?? {}) as Record<string, unknown>
      return 'app.runtime_dir' in attributes
    })

    assertEquals(hasRuntimeDirAttribute, false)
  } finally {
    consoleProxy.log = originalConsole.log
    consoleProxy.warn = originalConsole.warn
    consoleProxy.error = originalConsole.error
  }
})
export const testMeta = [
  {
    title: '[flow] R15 startDaemon: 应通过 RunDueSourcesUseCase 驱动 source runs',
    layer: 'flow',
    risks: ['R15'],
  },
] as const
