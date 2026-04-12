import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { withOwnedRuntime } from '../test_runtime.ts'
import { createDbClient } from './client.ts'
import { createSourceStateQuery } from './source_state_query.ts'
import { createSourceStateStore } from './source_state_store.ts'

const TEST_RUNTIME = join(Deno.cwd(), '.tmp', 'runtime-source-state-query')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

function createSqliteConfig(databaseName: string) {
  return {
    path: join(TEST_RUNTIME, databaseName),
    busyTimeout: '5s',
    journalMode: 'WAL' as const,
    retention: {
      maxAge: '1d',
      maxEntriesPerSource: 20,
      vacuum: 'off' as const,
    },
  }
}

test('sourceStateQuery: getSummaryCheckpoint 应返回 summary feed 的 updated_at', async () => {
  const sqlite = createSqliteConfig('summary-checkpoint.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const query = createSourceStateQuery({ db })
  const observedAt = '2026-04-12T10:00:00.000Z'

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Summary Feed' },
    entries: [],
    observedAt,
  })

  assertEquals(await query.getSummaryCheckpoint('summary.daily'), observedAt)

  db.$client.close()
})

test('sourceStateQuery: getSummaryInputs 应按 last_seen 窗口返回 keyed map 且按时间升序', async () => {
  const sqlite = createSqliteConfig('summary-inputs-window.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const query = createSourceStateQuery({ db })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss><channel><title>v1</title></channel></rss>',
    feedMapped: { title: 'Rust Feed V1' },
    entries: [
      { mapped: { id: 'skip-before', title: 'Skip Before' } },
      { mapped: { id: 'keep-2', title: 'Keep 2' } },
    ],
    observedAt: '2026-04-12T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss><channel><title>v2</title></channel></rss>',
    feedMapped: { title: 'Rust Feed Latest' },
    entries: [
      { mapped: { id: 'keep-1', title: 'Keep 1' } },
      { mapped: { id: 'keep-2', title: 'Keep 2 old snapshot' } },
    ],
    observedAt: '2026-04-12T11:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss><channel><title>v2.1</title></channel></rss>',
    feedMapped: { title: 'Rust Feed Latest+' },
    entries: [{ mapped: { id: 'keep-2', title: 'Keep 2 latest snapshot' } }],
    observedAt: '2026-04-12T12:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss><channel><title>v3</title></channel></rss>',
    feedMapped: { title: 'Rust Feed Newest' },
    entries: [{ mapped: { id: 'skip-after', title: 'Skip After' } }],
    observedAt: '2026-04-12T13:00:00.000Z',
  })

  const inputs = await query.getSummaryInputs(['rust'], {
    after: '2026-04-12T10:00:00.000Z',
    atOrBefore: '2026-04-12T12:00:00.000Z',
  })

  assertEquals(Object.keys(inputs), ['rust'])
  assertEquals(inputs.rust?.name, 'Rust Feed Newest')
  assertEquals(inputs.rust?.feed, { title: 'Rust Feed Newest' })
  assertEquals(inputs.rust?.entries, [
    { id: 'keep-1', title: 'Keep 1' },
    { id: 'keep-2', title: 'Keep 2 latest snapshot' },
  ])

  db.$client.close()
})

test('sourceStateQuery: getSummaryInputs 在 feed 没有 title 时应回退为空串', async () => {
  const sqlite = createSqliteConfig('summary-inputs-no-title.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const query = createSourceStateQuery({ db })

  await store.persistParsedSource({
    sourceId: 'untitled',
    parser: 'rss',
    payload: '<rss><channel></channel></rss>',
    feedMapped: { subtitle: 'No title here' },
    entries: [],
    observedAt: '2026-04-12T09:00:00.000Z',
  })

  const inputs = await query.getSummaryInputs(['untitled'], {
    after: '2026-04-12T08:00:00.000Z',
    atOrBefore: '2026-04-12T10:00:00.000Z',
  })

  assertEquals(inputs, {
    untitled: {
      name: '',
      feed: { subtitle: 'No title here' },
      entries: [],
    },
  })

  db.$client.close()
})

test('sourceStateQuery: getSummaryInputs 遇到坏 JSON 时应跳过该条记录', async () => {
  const sqlite = createSqliteConfig('summary-invalid-json.db')
  const db = createDbClient({ sqlite })
  const query = createSourceStateQuery({ db })

  db.$client
    .prepare(
      `INSERT INTO feeds(source_id, parser, payload_text, payload_hash, feed_text, fetched_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'rust',
      'rss',
      '<rss></rss>',
      'hash',
      '{"title":"Rust Feed"}',
      '2026-04-12T09:00:00.000Z',
      '2026-04-12T09:00:00.000Z',
    )
  db.$client
    .prepare(
      `INSERT INTO entries(source_id, entry_id, entry_text, first_seen_at, last_seen_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'rust',
      'bad-json',
      '{bad',
      '2026-04-12T09:00:00.000Z',
      '2026-04-12T11:00:00.000Z',
      '2026-04-12T11:00:00.000Z',
    )

  const inputs = await query.getSummaryInputs(['rust'], {
    after: '2026-04-12T10:00:00.000Z',
    atOrBefore: '2026-04-12T12:00:00.000Z',
  })

  assertEquals(inputs, {
    rust: {
      name: 'Rust Feed',
      feed: { title: 'Rust Feed' },
      entries: [],
    },
  })

  db.$client.close()
})
