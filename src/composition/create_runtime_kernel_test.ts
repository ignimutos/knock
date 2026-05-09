import { assertEquals } from '../testing/assert.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createInMemoryDb } from '../db/client.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
import type { RunSourceResult } from '../application/run_source/run_source_use_case.ts'
import { createRuntimePipeline } from './runtime_pipeline_builder.ts'
import { createRuntimeKernel } from './runtime_kernel_builder.ts'
import { test } from '../testing/test_api.ts'

function countRows(db: ReturnType<typeof createInMemoryDb>, tableName: string): number {
  const row = db.$client.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }
  return row.count
}

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

test('[contract] runtime kernel: scheduled 模式 listDueSources 仅返回 enabled+scheduled source', async () => {
  const runtimeDir = '/tmp/knock-runtime-kernel-list-due-sources-scheduled'
  const config = createTestConfig(runtimeDir)
  const kernel = createRuntimeKernel({
    config,
    definitions: compileDefinitionsFromResolvedConfig(config),
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
})

test('[contract] runtime kernel: immediate 模式 listDueSources 返回全部 enabled source（不看 schedule 匹配）', async () => {
  const runtimeDir = '/tmp/knock-runtime-kernel-list-due-sources-immediate'
  const config = createTestConfig(runtimeDir)
  const kernel = createRuntimeKernel({
    config,
    definitions: compileDefinitionsFromResolvedConfig(config),
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
})

test('[contract] runtime kernel: runDueSourcesUseCase 应支持 sourceId 显式执行', async () => {
  const runtimeDir = '/tmp/knock-runtime-kernel-run-due'
  const calls: string[] = []
  const config = createTestConfig(runtimeDir)
  const kernel = createRuntimeKernel({
    config,
    definitions: compileDefinitionsFromResolvedConfig(config),
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

test('[contract] runtime kernel: preview policy 应关闭 facts 与 dedupe 持久化', async () => {
  const factsDb = createInMemoryDb()
  const pipeline = createRuntimePipeline({
    factsDb,
    policy: {
      persistFacts: false,
      writeDedupe: false,
      allowExternalSideEffects: false,
      exposeToRecovery: false,
      exposeToPrune: false,
    },
    deliveryExecutors: {},
  })

  await pipeline.runRepository.insert({
    runId: 'run-preview',
    sourceId: 'source-a',
    trigger: 'preview',
    profile: 'preview',
    effectDomain: 'preview',
    scheduledAt: '2026-04-18T10:00:00.000Z',
    startedAt: '2026-04-18T10:00:00.000Z',
    status: 'running',
    counts: {
      fetchedCount: 0,
      parsedCount: 0,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 0,
    },
  })
  await pipeline.itemRepository.insertMany([
    {
      itemId: 'item-preview',
      sourceRunId: 'run-preview',
      sourceId: 'source-a',
      effectDomain: 'preview',
      normalized: {
        id: 'item-1',
        title: 'title',
        link: 'https://example.com',
        description: 'desc',
        content: 'content',
        published: '2026-04-18T10:00:00.000Z',
        updated: '2026-04-18T10:00:00.000Z',
      },
      status: 'ready',
    },
  ])
  await pipeline.deliveryAttemptRepository.insertPlanned({
    attemptId: 'attempt-preview',
    itemId: 'item-preview',
    sourceRunId: 'run-preview',
    deliveryId: 'delivery-a',
    channel: 'file',
    effectDomain: 'preview',
    attemptNumber: 1,
    status: 'planned',
    plannedAt: '2026-04-18T10:00:00.000Z',
  })

  assertEquals(
    await pipeline.deduplicationRepository.isItemDuplicate({
      sourceId: 'source-a',
      effectDomain: 'preview',
      fingerprint: 'fp-item',
    }),
    false,
  )
  await pipeline.deduplicationRepository.registerItemFingerprint({
    sourceId: 'source-a',
    effectDomain: 'preview',
    fingerprint: 'fp-item',
    recordedAt: '2026-04-18T10:00:00.000Z',
  })
  assertEquals(
    await pipeline.deduplicationRepository.isDeliveryDuplicate({
      sourceId: 'source-a',
      deliveryId: 'delivery-a',
      effectDomain: 'preview',
      fingerprint: 'fp-delivery',
    }),
    false,
  )
  await pipeline.deduplicationRepository.registerDeliveryFingerprint({
    sourceId: 'source-a',
    deliveryId: 'delivery-a',
    effectDomain: 'preview',
    fingerprint: 'fp-delivery',
    recordedAt: '2026-04-18T10:00:00.000Z',
  })

  assertEquals(countRows(factsDb, 'source_runs'), 0)
  assertEquals(countRows(factsDb, 'pipeline_items'), 0)
  assertEquals(countRows(factsDb, 'delivery_attempts'), 0)
  assertEquals(countRows(factsDb, 'deduplications'), 0)

  factsDb.$client.close()
})
