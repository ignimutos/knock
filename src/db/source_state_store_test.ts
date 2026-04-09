import { assert, assertEquals, assertExists } from '@std/assert'
import { join } from '@std/path'
import { withOwnedRuntime } from '../test_runtime.ts'
import { createDbClient } from './client.ts'
import { createSourceStateStore } from './source_state_store.ts'

const TEST_RUNTIME = join(Deno.cwd(), '.tmp', 'runtime-source-state-store')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

function createSqliteConfig(databaseName: string, vacuum: 'off' | 'afterPrune' = 'off') {
  return {
    path: join(TEST_RUNTIME, databaseName),
    busyTimeout: '5s',
    journalMode: 'WAL' as const,
    retention: {
      maxAge: '1d',
      maxEntriesPerSource: 2,
      vacuum,
    },
  }
}

test('sourceStateStore: persistParsedSource 应在 payload 未变化时仅刷新 last_seen_at', async () => {
  const sqlite = createSqliteConfig('persist.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })

  const input = {
    sourceId: 'rust',
    parser: 'rss' as const,
    payload: '<rss><channel><item><guid>id-1</guid></item></channel></rss>',
    feedMapped: { title: 'Rust Feed' },
    entries: [{ mapped: { id: 'id-1', title: 'Hello' } }],
  }

  await store.persistParsedSource(input)

  const beforeFeed = db.$client
    .prepare("SELECT payload_hash, updated_at FROM feeds WHERE source_id = 'rust'")
    .get() as { payload_hash: string; updated_at: string }
  const beforeEntry = db.$client
    .prepare(
      "SELECT last_seen_at, updated_at FROM entries WHERE source_id = 'rust' AND entry_id = 'id-1'",
    )
    .get() as { last_seen_at: string; updated_at: string }

  await new Promise((resolve) => setTimeout(resolve, 5))
  await store.persistParsedSource(input)

  const afterFeed = db.$client
    .prepare("SELECT payload_hash, updated_at FROM feeds WHERE source_id = 'rust'")
    .get() as {
    payload_hash: string
    updated_at: string
  }
  const afterEntry = db.$client
    .prepare(
      "SELECT last_seen_at, updated_at FROM entries WHERE source_id = 'rust' AND entry_id = 'id-1'",
    )
    .get() as { last_seen_at: string; updated_at: string }

  assertEquals(afterFeed.payload_hash, beforeFeed.payload_hash)
  assertEquals(afterFeed.updated_at, beforeFeed.updated_at)
  assertEquals(afterEntry.updated_at, beforeEntry.updated_at)
  assertEquals(afterEntry.last_seen_at > beforeEntry.last_seen_at, true)

  db.$client.close()
})

test('sourceStateStore: deliverIfNeeded 应接管去重判定并只记录一次 delivered', async () => {
  const sqlite = createSqliteConfig('delivered.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })

  let pushCount = 0
  assertEquals(
    await store.deliverIfNeeded('s1', 'i1', 't1', () => {
      pushCount += 1
    }),
    'delivered',
  )
  assertEquals(
    await store.deliverIfNeeded('s1', 'i1', 't1', () => {
      pushCount += 1
    }),
    'deduped',
  )
  assertEquals(pushCount, 1)
  assertEquals(
    (
      db.$client
        .prepare(
          'SELECT COUNT(*) as count FROM deliveries WHERE source_id=? AND item_id=? AND target_id=?',
        )
        .get('s1', 'i1', 't1') as { count: number }
    ).count,
    1,
  )

  db.$client.close()
})

test('sourceStateStore: pruneSourceState 应统一清理过期与超额的 entries 和 deliveries', () => {
  const sqlite = createSqliteConfig('prune.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })

  const sourceId = 's1'
  const timestamps = {
    expired: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    oldestKept: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    newer: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    newest: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }
  const insertEntry = db.$client.prepare(
    `INSERT INTO entries(source_id, entry_id, entry_text, first_seen_at, last_seen_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  )
  const insertDelivery = db.$client.prepare(
    `INSERT INTO deliveries(source_id, item_id, target_id, status, created_at)
     VALUES(?, ?, ?, 'delivered', ?)`,
  )

  insertEntry.run(
    sourceId,
    'old',
    '{"id":"old"}',
    timestamps.expired,
    timestamps.expired,
    timestamps.expired,
  )
  insertEntry.run(
    sourceId,
    'n1',
    '{"id":"n1"}',
    timestamps.oldestKept,
    timestamps.oldestKept,
    timestamps.oldestKept,
  )
  insertEntry.run(
    sourceId,
    'n2',
    '{"id":"n2"}',
    timestamps.newer,
    timestamps.newer,
    timestamps.newer,
  )
  insertEntry.run(
    sourceId,
    'n3',
    '{"id":"n3"}',
    timestamps.newest,
    timestamps.newest,
    timestamps.newest,
  )

  insertDelivery.run(sourceId, 'old', 't1', timestamps.expired)
  insertDelivery.run(sourceId, 'n1', 't1', timestamps.oldestKept)
  insertDelivery.run(sourceId, 'n2', 't1', timestamps.newer)
  insertDelivery.run(sourceId, 'n3', 't1', timestamps.newest)

  store.pruneSourceState(sourceId, 1)

  assertEquals(
    (
      db.$client
        .prepare('SELECT COUNT(*) as count FROM entries WHERE source_id = ?')
        .get(sourceId) as { count: number }
    ).count,
    2,
  )
  assertEquals(
    (
      db.$client
        .prepare('SELECT COUNT(*) as count FROM deliveries WHERE source_id = ?')
        .get(sourceId) as {
        count: number
      }
    ).count,
    2,
  )
  assertExists(
    db.$client.prepare("SELECT 1 FROM entries WHERE source_id = 's1' AND entry_id = 'n2'").get(),
  )
  assertExists(
    db.$client
      .prepare(
        "SELECT 1 FROM deliveries WHERE source_id = 's1' AND item_id = 'n2' AND target_id = 't1'",
      )
      .get(),
  )
  assertExists(
    db.$client
      .prepare(
        "SELECT 1 FROM deliveries WHERE source_id = 's1' AND item_id = 'n3' AND target_id = 't1'",
      )
      .get(),
  )
  assertEquals(
    Boolean(
      db.$client
        .prepare(
          "SELECT 1 FROM deliveries WHERE source_id = 's1' AND item_id = 'old' AND target_id = 't1'",
        )
        .get(),
    ),
    false,
  )
  assertEquals(
    Boolean(
      db.$client
        .prepare(
          "SELECT 1 FROM deliveries WHERE source_id = 's1' AND item_id = 'n1' AND target_id = 't1'",
        )
        .get(),
    ),
    false,
  )

  db.$client.close()
})

test('sourceStateStore: pruneSourceState 在 afterPrune 且发生清理时应委托 VACUUM', () => {
  const sqlite = createSqliteConfig('vacuum-after-prune.db', 'afterPrune')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })

  const executedSql: string[] = []
  const originalExec = db.$client.exec.bind(db.$client)
  db.$client.exec = (sql: string) => {
    executedSql.push(sql)
    return originalExec(sql)
  }

  const sourceId = 's1'
  const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const insertEntry = db.$client.prepare(
    `INSERT INTO entries(source_id, entry_id, entry_text, first_seen_at, last_seen_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  )
  insertEntry.run(
    sourceId,
    'old',
    JSON.stringify({ id: 'old', body: 'x'.repeat(4000) }),
    expired,
    expired,
    expired,
  )

  store.pruneSourceState(sourceId, 1)

  assert(executedSql.includes('VACUUM'), '发生清理后应执行 VACUUM')

  db.$client.close()
})

test('sourceStateStore: pruneSourceState 在未清理任何数据时不应触发 VACUUM', () => {
  const sqlite = createSqliteConfig('vacuum-without-prune.db', 'afterPrune')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })

  const executedSql: string[] = []
  const originalExec = db.$client.exec.bind(db.$client)
  db.$client.exec = (sql: string) => {
    executedSql.push(sql)
    return originalExec(sql)
  }

  const now = new Date().toISOString()
  const insertEntry = db.$client.prepare(
    `INSERT INTO entries(source_id, entry_id, entry_text, first_seen_at, last_seen_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  )
  const insertDelivery = db.$client.prepare(
    `INSERT INTO deliveries(source_id, item_id, target_id, status, created_at)
     VALUES(?, ?, ?, 'delivered', ?)`,
  )
  insertEntry.run('s1', 'n1', '{"id":"n1"}', now, now, now)
  insertEntry.run('s1', 'n2', '{"id":"n2"}', now, now, now)
  insertDelivery.run('s1', 'n1', 't1', now)
  insertDelivery.run('s1', 'n2', 't1', now)

  store.pruneSourceState('s1', 1)

  assertEquals(executedSql.includes('VACUUM'), false)

  db.$client.close()
})
