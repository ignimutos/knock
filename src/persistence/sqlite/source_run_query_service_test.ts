import { assertEquals, assertExists, assertRejects } from '../../testing/assert.ts'
import { createInMemoryDb } from '../../persistence/sqlite/client.ts'
import { insertDeliveryAttempt } from './delivery_attempt_repository.ts'
import { insertPipelineItem } from './item_repository.ts'
import { insertSourceRun } from './run_repository.ts'
import { createSourceRunQueryService } from './source_run_query_service.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R10
// layer: contract

test('[contract] R10 sqlite v2: query service 应按 run/item/attempt 返回主事实', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-1',
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

  await insertPipelineItem(db, {
    itemId: 'item-1',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-1',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'ready',
  })

  await insertDeliveryAttempt(db, {
    attemptId: 'attempt-1',
    itemId: 'item-1',
    sourceRunId: 'run-1',
    deliveryId: 'archive',
    channel: 'file',
    effectDomain: 'production',
    status: 'planned',
    plannedAt: '2026-04-13T09:00:02.000Z',
    attemptNumber: 1,
  })

  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-1')

  assertExists(view)
  assertEquals(view.run.runId, 'run-1')
  assertEquals(view.items.length, 1)
  assertEquals(view.items[0]?.itemId, 'item-1')
  assertEquals(view.attempts.length, 1)
  assertEquals(view.attempts[0]?.attemptId, 'attempt-1')
})

test('[contract] sqlite v2: query service 应回读真实 skippedReason', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-skipped-item',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'skipped',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
    finishedAt: '2026-04-13T09:00:02.000Z',
    counts: {
      fetchedCount: 1,
      parsedCount: 1,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 1,
    },
  })

  await insertPipelineItem(db, {
    itemId: 'item-skipped',
    sourceRunId: 'run-skipped-item',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-skipped',
      title: 'Skipped',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'skipped',
    skippedReason: 'no_deliveries',
  })

  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-skipped-item')

  assertExists(view)
  assertEquals(view.items[0]?.status, 'skipped')
  assertEquals(view.items[0]?.skippedReason, 'no_deliveries')
})

test('[contract] sqlite v2: query service 遇到坏 counts_json 应失败而不是伪装成合法 run', async () => {
  const db = createInMemoryDb()

  db.$client.exec(`
    INSERT INTO source_runs (
      run_id,
      source_id,
      trigger,
      profile,
      effect_domain,
      status,
      scheduled_at,
      started_at,
      counts_json
    ) VALUES (
      'run-bad-counts',
      'rust',
      'scheduled',
      'production',
      'production',
      'running',
      '2026-04-13T09:00:00.000Z',
      '2026-04-13T09:00:01.000Z',
      '{"parsedCount":"oops"}'
    )
  `)

  const query = createSourceRunQueryService(db)

  await assertRejects(() => query.getRun('run-bad-counts'))
})

test('[contract] sqlite v2: query service 遇到跨字段非法 source run 行应失败', async () => {
  const db = createInMemoryDb()

  db.$client.exec(`
    INSERT INTO source_runs (
      run_id,
      source_id,
      trigger,
      profile,
      effect_domain,
      status,
      scheduled_at,
      started_at,
      finished_at,
      counts_json
    ) VALUES (
      'run-bad-invariant',
      'rust',
      'scheduled',
      'production',
      'preview',
      'success',
      '2026-04-13T09:00:00.000Z',
      '2026-04-13T09:00:01.000Z',
      '2026-04-13T09:00:02.000Z',
      '{"fetchedCount":1,"parsedCount":1,"filteredCount":0,"duplicateItemCount":0,"deliveredCount":1,"failedAttemptCount":0,"skippedCount":0}'
    )
  `)

  const query = createSourceRunQueryService(db)

  await assertRejects(() => query.getRun('run-bad-invariant'))
})

test('[contract] sqlite v2: query service 遇到坏 normalized_json 应失败而不是伪装成合法 item', async () => {
  const db = createInMemoryDb()

  db.$client.exec(`
    INSERT INTO source_runs (
      run_id,
      source_id,
      trigger,
      profile,
      effect_domain,
      status,
      scheduled_at,
      started_at,
      counts_json
    ) VALUES (
      'run-bad-item',
      'rust',
      'scheduled',
      'production',
      'production',
      'running',
      '2026-04-13T09:00:00.000Z',
      '2026-04-13T09:00:01.000Z',
      '{"fetchedCount":0,"parsedCount":0,"filteredCount":0,"duplicateItemCount":0,"deliveredCount":0,"failedAttemptCount":0,"skippedCount":0}'
    )
  `)
  db.$client.exec(`
    INSERT INTO pipeline_items (
      item_id,
      source_run_id,
      source_id,
      effect_domain,
      normalized_json,
      status
    ) VALUES (
      'item-bad',
      'run-bad-item',
      'rust',
      'production',
      '{"id":1}',
      'ready'
    )
  `)

  const query = createSourceRunQueryService(db)

  await assertRejects(() => query.getRun('run-bad-item'))
})

test('[contract] sqlite v2: query service 遇到坏 rendered_snapshot_json 应失败而不是伪装成合法 attempt', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-bad-attempt',
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
  await insertPipelineItem(db, {
    itemId: 'item-bad-attempt',
    sourceRunId: 'run-bad-attempt',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-bad-attempt',
      title: 'Bad Attempt',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
    status: 'ready',
  })

  db.$client.exec(`
    INSERT INTO delivery_attempts (
      attempt_id,
      item_id,
      source_run_id,
      delivery_id,
      channel,
      effect_domain,
      attempt_number,
      status,
      rendered_snapshot_json,
      planned_at
    ) VALUES (
      'attempt-bad',
      'item-bad-attempt',
      'run-bad-attempt',
      'archive',
      'file',
      'production',
      1,
      'planned',
      '{"channel":"push"}',
      '2026-04-13T09:00:02.000Z'
    )
  `)

  const query = createSourceRunQueryService(db)

  await assertRejects(() => query.getRun('run-bad-attempt'))
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R10'],
  },
  {
    title: '[contract] R10 sqlite v2: query service 应按 run/item/attempt 返回主事实',
    layer: 'contract',
    risks: ['R10'],
  },
] as const
