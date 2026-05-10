import { assertEquals, assertExists } from '../../testing/assert.ts'
import { join } from 'node:path'
import { createLogger } from '../../core/logger.ts'
import { cwd, statPath } from '../../platform/fs.ts'
import { withOwnedRuntime } from '../../test_runtime.ts'
import { test as repoTest } from '../../testing/test_api.ts'
import { createDbClient } from './client.ts'

const TEST_RUNTIME = join(cwd(), '.tmp', 'runtime-db')

function test(name: string, fn: () => Promise<void> | void): void {
  repoTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('createDbClient: 使用 sqlite facts 初始化并可执行查询', () => {
  const db = createDbClient({
    sqlite: {
      path: join(TEST_RUNTIME, 'knock.db'),
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
  })
  const result = db.$client.prepare('SELECT 1 as ok').get()

  assertExists(result)
  db.$client.close()
})

test('createDbClient: 初始化时应记录结构化日志', () => {
  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'db.sqlite',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })

  const db = createDbClient({
    sqlite: {
      path: join(TEST_RUNTIME, 'knock.db'),
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
    logger,
  })
  db.$client.close()

  const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'db.sqlite' &&
        attributes['db.operation'] === 'init_db' &&
        attributes['db.outcome'] === 'start'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'db.sqlite' &&
        attributes['db.operation'] === 'init_db' &&
        attributes['db.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        ((item.attributes ?? {}) as Record<string, unknown>)['db.path'] ===
        join(TEST_RUNTIME, 'knock.db'),
    ),
    true,
  )
})

test('createDbClient: 应在 sqlite.path 指定位置创建数据库并应用 pragma', async () => {
  const databasePath = join(TEST_RUNTIME, 'nested', 'custom.db')
  const db = createDbClient({
    sqlite: {
      path: databasePath,
      busyTimeout: '1234ms',
      journalMode: 'DELETE',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
  })

  assertEquals((await statPath(databasePath)).isFile, true)
  assertEquals(db.$client.prepare('PRAGMA busy_timeout').get(), {
    timeout: 1234,
  })
  assertEquals(db.$client.prepare('PRAGMA journal_mode').get(), {
    journal_mode: 'delete',
  })
  db.$client.close()
})

test('createDbClient: 应初始化 facts 表', () => {
  const databasePath = join(TEST_RUNTIME, 'schema.db')
  const db = createDbClient({
    sqlite: {
      path: databasePath,
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
  })

  assertEquals(
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_runs'")
      .get(),
    {
      name: 'source_runs',
    },
  )
  assertEquals(
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_items'")
      .get(),
    {
      name: 'pipeline_items',
    },
  )
  assertEquals(
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_attempts'")
      .get(),
    {
      name: 'delivery_attempts',
    },
  )
  assertEquals(
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deduplications'")
      .get(),
    {
      name: 'deduplications',
    },
  )
  db.$client.close()
})

test('createDbClient: vacuum=afterPrune 时应保持数据库可初始化', () => {
  const databasePath = join(TEST_RUNTIME, 'vacuum.db')
  const db = createDbClient({
    sqlite: {
      path: databasePath,
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'afterPrune',
      },
    },
  })

  assertExists(db.$client.prepare('SELECT 1 as ok').get())
  db.$client.close()
})

test('createDbClient: 应初始化 facts 索引', () => {
  const databasePath = join(TEST_RUNTIME, 'indexes.db')
  const db = createDbClient({
    sqlite: {
      path: databasePath,
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '180d',
        maxEntriesPerSource: 1000,
        vacuum: 'off',
      },
    },
  })

  const indexes = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
    .all() as Array<{
    name: string
  }>

  assertEquals(
    indexes.some((item) => item.name === 'idx_source_runs_source_started_at'),
    true,
  )
  assertEquals(
    indexes.some((item) => item.name === 'idx_pipeline_items_run_id'),
    true,
  )
  assertEquals(
    indexes.some((item) => item.name === 'idx_delivery_attempts_run_id'),
    true,
  )
  assertEquals(
    indexes.some((item) => item.name === 'idx_delivery_attempts_item_id'),
    true,
  )
  assertEquals(
    indexes.some((item) => item.name === 'idx_deduplications_lookup'),
    true,
  )
  db.$client.close()
})
