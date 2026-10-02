import { assertEquals, assertExists, assertRejects } from '../../testing/assert.ts'
import { createInMemoryDb } from '../../persistence/sqlite/client.ts'
import { insertDeliveryAttempt } from './delivery_attempt_repository.ts'
import { insertSourceRun } from './run_repository.ts'
import { markInterruptedAttempts } from './recovery.ts'
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

  const runRow = db.$client
    .prepare('SELECT status, finished_at AS finishedAt FROM source_runs WHERE run_id = ?')
    .get('run-2') as { status: string; finishedAt: string | null }
  const attemptRow = db.$client
    .prepare(
      'SELECT status, reason, finished_at AS finishedAt FROM delivery_attempts WHERE source_run_id = ?',
    )
    .get('run-2') as { status: string; reason: string | null; finishedAt: string | null }

  assertExists(runRow)
  assertEquals(runRow.status, 'interrupted')
  assertEquals(runRow.finishedAt, '2026-04-13T10:30:00.000Z')
  assertExists(attemptRow)
  assertEquals(attemptRow.status, 'interrupted')
  assertEquals(attemptRow.reason, 'process_interrupted')
  assertEquals(attemptRow.finishedAt, '2026-04-13T10:30:00.000Z')
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

  const runRow = db.$client
    .prepare('SELECT status, finished_at AS finishedAt FROM source_runs WHERE run_id = ?')
    .get('run-rollback') as { status: string; finishedAt: string | null }
  const attemptRow = db.$client
    .prepare(
      'SELECT status, reason, finished_at AS finishedAt FROM delivery_attempts WHERE source_run_id = ?',
    )
    .get('run-rollback') as { status: string; reason: string | null; finishedAt: string | null }

  assertExists(runRow)
  assertEquals(runRow.status, 'running')
  assertEquals(runRow.finishedAt, null)
  assertExists(attemptRow)
  assertEquals(attemptRow.status, 'running')
  assertEquals(attemptRow.reason, null)
  assertEquals(attemptRow.finishedAt, null)
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R10'],
  },
  {
    title:
      '[contract] R10 sqlite v2: recovery 应将 planned/running attempts 标记为 interrupted 并终结受影响 run',
    layer: 'contract',
    risks: ['R10'],
  },
] as const
