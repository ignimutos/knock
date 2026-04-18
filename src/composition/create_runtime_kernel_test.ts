import { assertEquals } from '@std/assert'
import type { AppConfigResolved } from '../config/types.ts'
import type { RunSourceResult } from '../application/run_source_use_case.ts'
import { createRuntimeKernel } from './create_runtime_kernel.ts'

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
      {
        id: 'no-schedule',
        enabled: true,
        http: {
          url: 'https://example.com/no-schedule.xml',
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
  '[contract] runtime kernel: scheduled 模式 listDueSources 仅返回 enabled+scheduled source',
  async () => {
    const runtimeDir = '/tmp/knock-runtime-kernel-list-due-sources-scheduled'
    const kernel = createRuntimeKernel({
      config: createTestConfig(runtimeDir),
      now: () => '2026-04-18T10:00:00.000Z',
      runSourceUseCase: {
        execute: () => Promise.resolve({} as RunSourceResult),
      },
    })

    const items = await kernel.sourceQueryService.listDueSources(
      '2026-04-18T10:00:00.000Z',
      'scheduled',
    )

    assertEquals(
      items.map((item) => item.source.sourceId),
      ['enabled'],
    )
  },
)

Deno.test(
  '[contract] runtime kernel: immediate 模式 listDueSources 返回全部 enabled source（不看 schedule 匹配）',
  async () => {
    const runtimeDir = '/tmp/knock-runtime-kernel-list-due-sources-immediate'
    const kernel = createRuntimeKernel({
      config: createTestConfig(runtimeDir),
      now: () => '2026-04-18T10:00:00.000Z',
      runSourceUseCase: {
        execute: () => Promise.resolve({} as RunSourceResult),
      },
    })

    const items = await kernel.sourceQueryService.listDueSources(
      '2026-04-18T10:00:01.000Z',
      'immediate',
    )

    assertEquals(
      items.map((item) => item.source.sourceId),
      ['enabled', 'no-schedule'],
    )
  },
)

Deno.test('[contract] runtime kernel: runDueSourcesUseCase 应支持 sourceId 显式执行', async () => {
  const runtimeDir = '/tmp/knock-runtime-kernel-run-due'
  const calls: string[] = []
  const kernel = createRuntimeKernel({
    config: createTestConfig(runtimeDir),
    now: () => '2026-04-18T11:00:00.000Z',
    runSourceUseCase: {
      execute: (input) => {
        calls.push(`${input.source.sourceId}:${input.trigger}:${input.scheduledAt ?? 'missing'}`)
        return Promise.resolve({} as RunSourceResult)
      },
    },
  })

  await kernel.runDueSourcesUseCase.execute({
    trigger: 'immediate',
    sourceId: 'enabled',
    scheduledAt: '2026-04-18T11:05:00.000Z',
  })

  assertEquals(calls, ['enabled:immediate:2026-04-18T11:05:00.000Z'])
})
