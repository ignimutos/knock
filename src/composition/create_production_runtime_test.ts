import { assert, assertEquals } from '@std/assert'
import type { RunDueSourcesCommand } from '../application/run_due_sources_use_case.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createProductionRuntime } from './create_production_runtime.ts'

function createTestConfig(runtimeDir: string): AppConfigResolved {
  return {
    runtimeDir,
    language: 'zh-CN',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: `${runtimeDir}/facts.db`,
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '7d',
        maxEntriesPerSource: 100,
        vacuum: 'off',
      },
    },
    deliveries: [],
    sources: [
      {
        id: 'enabled',
        enabled: true,
        schedule: '* * * * *',
        http: {
          url: 'https://example.com/feed.xml',
        },
        syndication: {},
        deliveries: [],
      },
      {
        id: 'disabled',
        enabled: false,
        schedule: '* * * * *',
        http: {
          url: 'https://example.com/disabled.xml',
        },
        syndication: {},
        deliveries: [],
      },
    ],
    logging: {
      level: 'info',
      sinks: {},
    },
  }
}

Deno.test(
  '[contract] production composition: runImmediate 应通过 RunDueSourcesUseCase 统一判定 due source',
  async () => {
    const runtimeDir = '/tmp/knock-production-composition-run-immediate'
    const commands: RunDueSourcesCommand[] = []

    const runtime = createProductionRuntime({
      config: createTestConfig(runtimeDir),
      now: () => '2026-04-18T12:00:00.000Z',
      keepAlive: false,
      runDueSourcesUseCase: {
        execute: (command) => {
          commands.push(command)
          return Promise.resolve([])
        },
      },
    })

    try {
      await runtime.runImmediate()
    } finally {
      runtime.stop()
    }

    assertEquals(commands, [
      {
        trigger: 'immediate',
        scheduledAt: '2026-04-18T12:00:00.000Z',
      },
    ])
  },
)

Deno.test(
  '[contract] production composition: scheduled cron tick 应委托 RunDueSourcesUseCase 统一判定 due source',
  async () => {
    const runtimeDir = '/tmp/knock-production-composition-enter-daemon'
    const commands: RunDueSourcesCommand[] = []
    let scheduledTick: (() => Promise<void>) | undefined

    const runtime = createProductionRuntime({
      config: createTestConfig(runtimeDir),
      now: () => '2026-04-18T12:00:00.000Z',
      keepAlive: false,
      runDueSourcesUseCase: {
        execute: (command) => {
          commands.push(command)
          return Promise.resolve([])
        },
      },
      scheduleDueSources: (task) => {
        scheduledTick = task
        return {
          stop() {
            // no-op
          },
        }
      },
    })

    try {
      await runtime.enterDaemon()
      assert(scheduledTick)
      await scheduledTick()
    } finally {
      runtime.stop()
    }

    assertEquals(
      commands.every((command) => command.sourceId === undefined),
      true,
    )
    assertEquals(
      commands.some((command) => command.trigger === 'scheduled'),
      true,
    )
  },
)
