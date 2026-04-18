import { assertEquals } from '@std/assert'
import { createInMemoryDb } from '../../db/client.ts'
import { registerItemFingerprint } from './deduplication_repository.ts'
import { insertDeliveryAttempt } from './delivery_attempt_repository.ts'
import { insertPipelineItem } from './item_repository.ts'
import { createPruneFactsRepository } from './prune_facts_repository.ts'
import { insertSourceRun } from './run_repository.ts'

function countRows(db: ReturnType<typeof createInMemoryDb>, tableName: string): number {
  const row = db.$client.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }
  return row.count
}

function listRunIds(db: ReturnType<typeof createInMemoryDb>): string[] {
  return (
    db.$client.prepare('SELECT run_id AS runId FROM source_runs ORDER BY run_id').all() as Array<{
      runId: string
    }>
  ).map((row) => row.runId)
}

async function seedFinishedRun(
  db: ReturnType<typeof createInMemoryDb>,
  input: {
    runId: string
    sourceId: string
    startedAt: string
    finishedAt: string
  },
): Promise<void> {
  await insertSourceRun(db, {
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

  await insertPipelineItem(db, {
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

  await insertDeliveryAttempt(db, {
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
  '[contract] pruneFactsRepository: 应删除超龄已完成 facts 与旧 deduplications',
  async () => {
    const db = createInMemoryDb()
    const repository = createPruneFactsRepository(db)

    await seedFinishedRun(db, {
      runId: 'run-old',
      sourceId: 'rust',
      startedAt: '2026-04-01T12:00:00.000Z',
      finishedAt: '2026-04-01T12:01:00.000Z',
    })
    await seedFinishedRun(db, {
      runId: 'run-recent',
      sourceId: 'rust',
      startedAt: '2026-04-17T12:00:00.000Z',
      finishedAt: '2026-04-17T12:01:00.000Z',
    })
    await insertSourceRun(db, {
      runId: 'run-running',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'running',
      scheduledAt: '2026-04-01T13:00:00.000Z',
      startedAt: '2026-04-01T13:00:00.000Z',
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

    await registerItemFingerprint(db, {
      deduplicationKey: 'production:item:rust:old',
      scope: 'item',
      scopeId: 'rust',
      effectDomain: 'production',
      fingerprint: 'old',
      recordedAt: '2026-04-01T12:00:00.000Z',
    })
    await registerItemFingerprint(db, {
      deduplicationKey: 'production:item:rust:recent',
      scope: 'item',
      scopeId: 'rust',
      effectDomain: 'production',
      fingerprint: 'recent',
      recordedAt: '2026-04-17T12:00:00.000Z',
    })

    const result = await repository.prune({
      now: '2026-04-18T12:00:00.000Z',
      maxAge: '7d',
      maxEntriesPerSource: 100,
    })

    assertEquals(result, {
      deletedRuns: 1,
      deletedItems: 1,
      deletedAttempts: 1,
      deletedDeduplications: 1,
    })
    assertEquals(listRunIds(db), ['run-recent', 'run-running'])
    assertEquals(countRows(db, 'pipeline_items'), 1)
    assertEquals(countRows(db, 'delivery_attempts'), 1)
    assertEquals(countRows(db, 'deduplications'), 1)
  },
)

Deno.test('[contract] pruneFactsRepository: 应按 source 保留最新 N 个已完成 runs', async () => {
  const db = createInMemoryDb()
  const repository = createPruneFactsRepository(db)

  await seedFinishedRun(db, {
    runId: 'run-1',
    sourceId: 'rust',
    startedAt: '2026-04-10T10:00:00.000Z',
    finishedAt: '2026-04-10T10:01:00.000Z',
  })
  await seedFinishedRun(db, {
    runId: 'run-2',
    sourceId: 'rust',
    startedAt: '2026-04-11T10:00:00.000Z',
    finishedAt: '2026-04-11T10:01:00.000Z',
  })
  await seedFinishedRun(db, {
    runId: 'run-3',
    sourceId: 'rust',
    startedAt: '2026-04-12T10:00:00.000Z',
    finishedAt: '2026-04-12T10:01:00.000Z',
  })
  await seedFinishedRun(db, {
    runId: 'run-other',
    sourceId: 'go',
    startedAt: '2026-04-10T10:00:00.000Z',
    finishedAt: '2026-04-10T10:01:00.000Z',
  })

  const result = await repository.prune({
    now: '2026-04-18T12:00:00.000Z',
    maxAge: '30d',
    maxEntriesPerSource: 2,
  })

  assertEquals(result, {
    deletedRuns: 1,
    deletedItems: 1,
    deletedAttempts: 1,
    deletedDeduplications: 0,
  })
  assertEquals(listRunIds(db), ['run-2', 'run-3', 'run-other'])
  assertEquals(countRows(db, 'pipeline_items'), 3)
  assertEquals(countRows(db, 'delivery_attempts'), 3)
})
