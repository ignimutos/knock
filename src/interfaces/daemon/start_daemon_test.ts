import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { withOwnedRuntime } from '../../test_runtime.ts'
import { createDaemonRuntime } from './create_daemon_runtime.ts'
import { startDaemon } from './start_daemon.ts'

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

Deno.test('[flow] R15 startDaemon: 应通过 RunDueSourcesUseCase 驱动 source runs', async () => {
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

Deno.test('[contract] daemon logger: emitted attributes 不应包含 app.runtime_dir', async () => {
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

    await withOwnedRuntime(async ({ runtimeDir }) => {
      const daemon = createDaemonRuntime({
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
            format: 'json',
            sinks: {
              console: {
                type: 'console',
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
