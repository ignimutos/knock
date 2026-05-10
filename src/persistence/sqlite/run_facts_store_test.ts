import { assertEquals } from '../../testing/assert.ts'
import { createInMemoryDb } from '../../persistence/sqlite/client.ts'
import { createSqliteRunFactsStore } from './run_facts_store.ts'
import { test } from '../../testing/test_api.ts'

test('[contract] sqlite run facts store: 应写入并更新 run/item/attempt 事实', async () => {
  const db = createInMemoryDb()
  const store = createSqliteRunFactsStore(db)

  await store.insertRun({
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-05-10T08:00:00.000Z',
    startedAt: '2026-05-10T08:00:00.000Z',
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
  await store.setFeedSnapshot('run-1', {
    title: 'Rust Feed',
    link: 'https://example.com',
    description: '',
    generator: 'rss',
    language: 'en',
    published: '2026-05-10T08:00:00.000Z',
  })
  await store.insertItems([
    {
      itemId: 'item-1',
      sourceRunId: 'run-1',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-1',
        title: 'Title',
        link: 'https://example.com/1',
        description: '',
        content: '',
        published: '',
        updated: '',
      },
      status: 'ready',
    },
  ])
  await store.updateItemStatus('item-1', 'delivered')
  await store.insertPlannedAttempt({
    attemptId: 'attempt-1',
    itemId: 'item-1',
    sourceRunId: 'run-1',
    deliveryId: 'local',
    channel: 'file',
    effectDomain: 'production',
    attemptNumber: 1,
    status: 'planned',
    plannedAt: '2026-05-10T08:00:01.000Z',
  })
  await store.finishAttempt('attempt-1', {
    status: 'delivered',
    startedAt: '2026-05-10T08:00:02.000Z',
    finishedAt: '2026-05-10T08:00:03.000Z',
  })
  await store.updateRun({
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'success',
    scheduledAt: '2026-05-10T08:00:00.000Z',
    startedAt: '2026-05-10T08:00:00.000Z',
    finishedAt: '2026-05-10T08:00:03.000Z',
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

  const runRow = db.$client
    .prepare(
      'SELECT status, finished_at AS finishedAt, feed_json AS feedJson FROM source_runs WHERE run_id = ?',
    )
    .get('run-1') as { status: string; finishedAt: string | null; feedJson: string | null }
  const itemRow = db.$client
    .prepare('SELECT status FROM pipeline_items WHERE item_id = ?')
    .get('item-1') as { status: string }
  const attemptRow = db.$client
    .prepare(
      'SELECT status, started_at AS startedAt, finished_at AS finishedAt FROM delivery_attempts WHERE attempt_id = ?',
    )
    .get('attempt-1') as {
    status: string
    startedAt: string | null
    finishedAt: string | null
  }

  assertEquals(runRow.status, 'success')
  assertEquals(runRow.finishedAt, '2026-05-10T08:00:03.000Z')
  assertEquals(JSON.parse(runRow.feedJson ?? '{}').title, 'Rust Feed')
  assertEquals(itemRow.status, 'delivered')
  assertEquals(attemptRow.status, 'delivered')
  assertEquals(attemptRow.startedAt, '2026-05-10T08:00:02.000Z')
  assertEquals(attemptRow.finishedAt, '2026-05-10T08:00:03.000Z')
})
