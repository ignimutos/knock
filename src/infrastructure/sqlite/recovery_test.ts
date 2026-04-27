import { assertEquals, assertExists, assertRejects } from '@std/assert'
import { createInMemoryDb } from '../../db/client.ts'
import { insertDeliveryAttempt } from './delivery_attempt_repository.ts'
import { insertSourceRun } from './run_repository.ts'
import { markInterruptedAttempts } from './recovery.ts'
import { createSourceRunQueryService } from './source_run_query_service.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R10
// layer: contract

test('[contract] R10 sqlite v2: recovery 应将 planned/running attempts 标记为 interrupted 并终结受影响 run', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-2',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T10:00:00.000Z',
    startedAt: '2026-04-13T10:00:01.000Z',
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

  await db.$client.exec(`
    INSERT INTO pipeline_items (
      item_id,
      source_run_id,
      source_id,
      effect_domain,
      normalized_json,
      status
    ) VALUES (
      'item-2',
      'run-2',
      'rust',
      'production',
      '{"id":"entry-2","title":"Hello","link":"","description":"","content":"","published":"","updated":""}',
      'ready'
    )
  `)

  await insertDeliveryAttempt(db, {
    attemptId: 'attempt-2',
    itemId: 'item-2',
    sourceRunId: 'run-2',
    deliveryId: 'telegram',
    channel: 'push',
    effectDomain: 'production',
    status: 'running',
    plannedAt: '2026-04-13T10:00:02.000Z',
    startedAt: '2026-04-13T10:00:03.000Z',
    attemptNumber: 1,
  })

  await markInterruptedAttempts(db, '2026-04-13T10:30:00.000Z')

  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-2')

  assertExists(view)
  assertEquals(view.run.status, 'interrupted')
  assertEquals(view.run.finishedAt, '2026-04-13T10:30:00.000Z')
  assertEquals(view.attempts[0]?.status, 'interrupted')
  assertEquals(view.attempts[0]?.reason, 'process_interrupted')
  assertEquals(view.attempts[0]?.finishedAt, '2026-04-13T10:30:00.000Z')
})

test('[contract] sqlite v2: recovery 失败时应回滚 attempt 更新，避免 run/attempt 失配', async () => {
  const db = createInMemoryDb()

  await insertSourceRun(db, {
    runId: 'run-rollback',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T10:40:00.000Z',
    startedAt: '2026-04-13T10:40:01.000Z',
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

  await db.$client.exec(`
    INSERT INTO pipeline_items (
      item_id,
      source_run_id,
      source_id,
      effect_domain,
      normalized_json,
      status
    ) VALUES (
      'item-rollback',
      'run-rollback',
      'rust',
      'production',
      '{"id":"entry-r","title":"Rollback","link":"","description":"","content":"","published":"","updated":""}',
      'ready'
    )
  `)

  await insertDeliveryAttempt(db, {
    attemptId: 'attempt-rollback',
    itemId: 'item-rollback',
    sourceRunId: 'run-rollback',
    deliveryId: 'telegram',
    channel: 'push',
    effectDomain: 'production',
    status: 'running',
    plannedAt: '2026-04-13T10:40:02.000Z',
    startedAt: '2026-04-13T10:40:03.000Z',
    attemptNumber: 1,
  })

  db.$client.exec(
    "CREATE TRIGGER fail_source_run_interrupt BEFORE UPDATE ON source_runs BEGIN SELECT RAISE(ABORT, 'boom'); END;",
  )

  await assertRejects(() => markInterruptedAttempts(db, '2026-04-13T10:40:30.000Z'))

  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-rollback')

  assertExists(view)
  assertEquals(view.run.status, 'running')
  assertEquals(view.run.finishedAt, undefined)
  assertEquals(view.attempts[0]?.status, 'running')
  assertEquals(view.attempts[0]?.reason, undefined)
  assertEquals(view.attempts[0]?.finishedAt, undefined)
})
