import { assertEquals, assertThrows } from '../../testing/assert.ts'
import { createInMemoryDb } from '../../db/client.ts'
import {
  createDeduplicationRepository,
  registerItemFingerprint,
} from './deduplication_repository.ts'
import { insertDeliveryAttempt } from './delivery_attempt_repository.ts'
import { insertPipelineItem } from './item_repository.ts'
import { insertSourceRun } from './run_repository.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R12
// layer: contract

interface ForeignKeyRow {
  id: number
  seq: number
  table: string
  from: string
  to: string
}

function listForeignKeys(
  db: ReturnType<typeof createInMemoryDb>,
  tableName: string,
): Array<{ table: string; from: string[]; to: string[] }> {
  const rows = db.$client
    .prepare(`PRAGMA foreign_key_list('${tableName}')`)
    .all() as unknown as ForeignKeyRow[]
  const grouped = new Map<number, { table: string; from: string[]; to: string[] }>()

  for (const row of rows) {
    const current = grouped.get(row.id) ?? {
      table: row.table,
      from: [],
      to: [],
    }
    current.from[row.seq] = row.from
    current.to[row.seq] = row.to
    grouped.set(row.id, current)
  }

  return [...grouped.values()]
}

test('[contract] sqlite v2: schema 应初始化 source_runs pipeline_items delivery_attempts deduplications 表', () => {
  const db = createInMemoryDb()

  const tableNames = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>

  assertEquals(
    tableNames.some((item) => item.name === 'source_runs'),
    true,
  )
  assertEquals(
    tableNames.some((item) => item.name === 'pipeline_items'),
    true,
  )
  assertEquals(
    tableNames.some((item) => item.name === 'delivery_attempts'),
    true,
  )
  assertEquals(
    tableNames.some((item) => item.name === 'deduplications'),
    true,
  )
})

test('[contract] R12 sqlite v2: deduplication repository 应按 effectDomain + scope 判定重复', async () => {
  const db = createInMemoryDb()
  const repository = createDeduplicationRepository(db)

  await registerItemFingerprint(db, {
    deduplicationKey: 'production:item:rust:entry-1',
    scope: 'item',
    scopeId: 'rust',
    effectDomain: 'production',
    fingerprint: 'entry-1',
    recordedAt: '2026-04-13T09:00:00.000Z',
  })

  assertEquals(
    await repository.isDuplicate({
      deduplicationKey: 'production:item:rust:entry-1',
      scope: 'item',
      scopeId: 'rust',
      effectDomain: 'production',
      fingerprint: 'entry-1',
    }),
    true,
  )
  assertEquals(
    await repository.isDuplicate({
      deduplicationKey: 'preview:item:rust:entry-1',
      scope: 'item',
      scopeId: 'rust',
      effectDomain: 'preview',
      fingerprint: 'entry-1',
    }),
    false,
  )
})

test('[contract] sqlite v2: schema 应将 effect_domain 纳入 run/item/attempt 跨记录外键', () => {
  const db = createInMemoryDb()

  assertEquals(listForeignKeys(db, 'pipeline_items'), [
    {
      table: 'source_runs',
      from: ['source_run_id', 'effect_domain'],
      to: ['run_id', 'effect_domain'],
    },
  ])

  assertEquals(listForeignKeys(db, 'delivery_attempts'), [
    {
      table: 'pipeline_items',
      from: ['source_run_id', 'item_id', 'effect_domain'],
      to: ['source_run_id', 'item_id', 'effect_domain'],
    },
    {
      table: 'pipeline_items',
      from: ['item_id', 'effect_domain'],
      to: ['item_id', 'effect_domain'],
    },
    {
      table: 'source_runs',
      from: ['source_run_id', 'effect_domain'],
      to: ['run_id', 'effect_domain'],
    },
  ])
})

test('[contract] sqlite v2: pipeline item 应要求 source_run_id 指向已存在 source_runs.run_id', async () => {
  const db = createInMemoryDb()

  await assertThrows(() =>
    insertPipelineItem(db, {
      itemId: 'item-orphan',
      sourceRunId: 'missing-run',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-orphan',
        title: 'Orphan',
        link: '',
        description: '',
        content: '',
        published: '',
        updated: '',
      },
      status: 'ready',
    }),
  )
})

test('[contract] sqlite v2: delivery attempt 应要求 item_id 指向已存在 pipeline item', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-foreign-key',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
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

  await assertThrows(() =>
    insertDeliveryAttempt(db, {
      attemptId: 'attempt-orphan-item',
      itemId: 'missing-item',
      sourceRunId: 'run-foreign-key',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-13T09:00:02.000Z',
      attemptNumber: 1,
    }),
  )
})

test('[contract] sqlite v2: delivery attempt 不应允许 source_run_id 脱离所属 pipeline item', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-a',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
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
  await insertSourceRun(db, {
    runId: 'run-b',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:05:00.000Z',
    startedAt: '2026-04-13T09:05:01.000Z',
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

  await insertPipelineItem(db, {
    itemId: 'item-a',
    sourceRunId: 'run-a',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-a',
      title: 'Entry A',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'ready',
  })

  await assertThrows(() =>
    insertDeliveryAttempt(db, {
      attemptId: 'attempt-drift',
      itemId: 'item-a',
      sourceRunId: 'run-b',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-13T09:00:02.000Z',
      attemptNumber: 1,
    }),
  )
})

test('[contract] sqlite v2: pipeline item 不应允许引用不同 effect_domain 的 run', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-production',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
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

  await assertThrows(() =>
    insertPipelineItem(db, {
      itemId: 'item-preview-drift',
      sourceRunId: 'run-production',
      sourceId: 'rust',
      effectDomain: 'preview',
      normalized: {
        id: 'entry-preview-drift',
        title: 'Preview Drift',
        link: '',
        description: '',
        content: '',
        published: '',
        updated: '',
      },
      status: 'ready',
    }),
  )
})

test('[contract] sqlite v2: delivery attempt 不应允许引用不同 effect_domain 的 run', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-production',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
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
  await insertSourceRun(db, {
    runId: 'run-preview',
    sourceId: 'rust',
    trigger: 'preview',
    profile: 'preview',
    effectDomain: 'preview',
    status: 'running',
    scheduledAt: '2026-04-13T09:05:00.000Z',
    startedAt: '2026-04-13T09:05:01.000Z',
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
  await insertPipelineItem(db, {
    itemId: 'item-production',
    sourceRunId: 'run-production',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-production',
      title: 'Production Entry',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'ready',
  })

  await assertThrows(() =>
    insertDeliveryAttempt(db, {
      attemptId: 'attempt-run-domain-drift',
      itemId: 'item-production',
      sourceRunId: 'run-preview',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'preview',
      status: 'planned',
      plannedAt: '2026-04-13T09:00:02.000Z',
      attemptNumber: 1,
    }),
  )
})

test('[contract] sqlite v2: delivery attempt 不应允许引用不同 effect_domain 的 item', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-production',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
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
  await insertSourceRun(db, {
    runId: 'run-preview',
    sourceId: 'rust',
    trigger: 'preview',
    profile: 'preview',
    effectDomain: 'preview',
    status: 'running',
    scheduledAt: '2026-04-13T09:05:00.000Z',
    startedAt: '2026-04-13T09:05:01.000Z',
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
  await insertPipelineItem(db, {
    itemId: 'item-preview',
    sourceRunId: 'run-preview',
    sourceId: 'rust',
    effectDomain: 'preview',
    normalized: {
      id: 'entry-preview',
      title: 'Preview Entry',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'ready',
  })

  await assertThrows(() =>
    insertDeliveryAttempt(db, {
      attemptId: 'attempt-item-domain-drift',
      itemId: 'item-preview',
      sourceRunId: 'run-preview',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-13T09:00:02.000Z',
      attemptNumber: 1,
    }),
  )
})
