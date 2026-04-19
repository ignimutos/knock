import { assert, assertEquals, assertExists } from '@std/assert'
import type { RunDueSourcesCommand } from '../application/run_due_sources_use_case.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createInMemoryDb } from '../db/client.ts'
import { registerItemFingerprint } from '../infrastructure/sqlite/deduplication_repository.ts'
import { insertDeliveryAttempt } from '../infrastructure/sqlite/delivery_attempt_repository.ts'
import { insertPipelineItem } from '../infrastructure/sqlite/item_repository.ts'
import { insertSourceRun } from '../infrastructure/sqlite/run_repository.ts'
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

async function seedFinishedRun(input: {
  db: ReturnType<typeof createInMemoryDb>
  runId: string
  sourceId: string
  startedAt: string
  finishedAt: string
}): Promise<void> {
  await insertSourceRun(input.db, {
    runId: input.runId,
    sourceId: input.sourceId,
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'success',
    scheduledAt: input.startedAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    counts: {
      fetchedCount: 1,
      parsedCount: 1,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 1,
      failedAttemptCount: 0,
      skippedCount: 0,
    },
  })

  await insertPipelineItem(input.db, {
    itemId: `item-${input.runId}`,
    sourceRunId: input.runId,
    sourceId: input.sourceId,
    effectDomain: 'production',
    normalized: {
      id: `entry-${input.runId}`,
      title: input.runId,
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'delivered',
  })

  await insertDeliveryAttempt(input.db, {
    attemptId: `attempt-${input.runId}`,
    itemId: `item-${input.runId}`,
    sourceRunId: input.runId,
    deliveryId: 'archive',
    channel: 'file',
    effectDomain: 'production',
    attemptNumber: 1,
    status: 'delivered',
    plannedAt: input.startedAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  })
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

Deno.test(
  '[contract] production composition: 应暴露 queryRunsUseCase 并回读 run/item/attempt',
  async () => {
    const factsDb = createInMemoryDb()

    await insertSourceRun(factsDb, {
      runId: 'run-query-runtime',
      sourceId: 'enabled',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'running',
      scheduledAt: '2026-04-18T12:00:00.000Z',
      startedAt: '2026-04-18T12:00:01.000Z',
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
    await insertPipelineItem(factsDb, {
      itemId: 'item-query-runtime',
      sourceRunId: 'run-query-runtime',
      sourceId: 'enabled',
      effectDomain: 'production',
      normalized: {
        id: 'entry-query-runtime',
        title: 'runtime query',
        link: '',
        description: '',
        content: '',
        published: '',
        updated: '',
      },
      status: 'ready',
    })
    await insertDeliveryAttempt(factsDb, {
      attemptId: 'attempt-query-runtime',
      itemId: 'item-query-runtime',
      sourceRunId: 'run-query-runtime',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'production',
      attemptNumber: 1,
      status: 'planned',
      plannedAt: '2026-04-18T12:00:02.000Z',
    })

    const runtime = createProductionRuntime({
      config: createTestConfig('/tmp/knock-production-composition-query-usecase'),
      now: () => '2026-04-18T12:00:03.000Z',
      keepAlive: false,
      factsDb,
    })

    try {
      const run = await runtime.queryRunsUseCase.getRun('run-query-runtime')

      assertExists(run)
      assertEquals(run.run.runId, 'run-query-runtime')
      assertEquals(run.items.length, 1)
      assertEquals(run.items[0]?.itemId, 'item-query-runtime')
      assertEquals(run.attempts.length, 1)
      assertEquals(run.attempts[0]?.attemptId, 'attempt-query-runtime')
    } finally {
      runtime.stop()
    }
  },
)

Deno.test(
  '[contract] production composition: 应暴露 pruneFactsUseCase 并删除过期 run 与 dedupe',
  async () => {
    const factsDb = createInMemoryDb()

    await seedFinishedRun({
      db: factsDb,
      runId: 'run-prune-runtime-old',
      sourceId: 'enabled',
      startedAt: '2026-04-01T12:00:00.000Z',
      finishedAt: '2026-04-01T12:01:00.000Z',
    })
    await registerItemFingerprint(factsDb, {
      deduplicationKey: 'production:item:enabled:prune-old',
      scope: 'item',
      scopeId: 'enabled',
      effectDomain: 'production',
      fingerprint: 'prune-old',
      recordedAt: '2026-04-01T12:00:00.000Z',
    })

    const runtime = createProductionRuntime({
      config: createTestConfig('/tmp/knock-production-composition-prune-usecase'),
      now: () => '2026-04-18T12:00:00.000Z',
      keepAlive: false,
      factsDb,
    })

    try {
      const result = await runtime.pruneFactsUseCase.execute({
        maxAge: '7d',
        maxEntriesPerSource: 100,
      })

      assertEquals(result, {
        deletedRuns: 1,
        deletedItems: 1,
        deletedAttempts: 1,
        deletedDeduplications: 1,
      })
    } finally {
      runtime.stop()
    }
  },
)
