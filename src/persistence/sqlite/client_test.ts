import { assertEquals, assertExists, assertThrows } from '../../testing/assert.ts'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
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
        interval: '24h',
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
        interval: '24h',
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
        interval: '24h',
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
        interval: '24h',
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
        interval: '24h',
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
        interval: '24h',
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

function createTestSqliteConfig(path: string): Parameters<typeof createDbClient>[0]['sqlite'] {
  return {
    path,
    busyTimeout: '5s',
    journalMode: 'WAL',
    retention: {
      maxAge: '180d',
      maxEntriesPerSource: 1000,
      vacuum: 'off',
      interval: '24h',
    },
  }
}

function seedDatabase(path: string): void {
  // 用 DELETE 模式种子，确保数据真实写入主文件；WAL 种子 close 后数据可能仍留在 -wal，
  // 截断主文件会被 WAL 回放掩盖，无法稳定构造损坏现场。
  const db = createDbClient({
    sqlite: { ...createTestSqliteConfig(path), journalMode: 'DELETE' },
  })
  db.$client.exec('CREATE TABLE IF NOT EXISTS seed_rows (id INTEGER PRIMARY KEY, value TEXT)')
  const insert = db.$client.prepare('INSERT INTO seed_rows VALUES (?, ?)')
  for (let i = 0; i < 500; i++) insert.run(i, `value-${i}`)
  db.$client.close()
}

function createCapturingLogger(logs: string[]) {
  return createLogger({
    enabled: true,
    level: 'info',
    module: 'db.sqlite',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })
}

function findFatalCorruptRecord(logs: string[]): Record<string, unknown> {
  const record = logs
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'db.sqlite' &&
        attributes['db.outcome'] === 'failure' &&
        attributes['db.integrity'] === 'corrupt'
      )
    })
  assertExists(record)
  return record
}

test('createDbClient: 数据库文件损坏时应记录 fatal 并抛出可执行报错', () => {
  const databasePath = join(TEST_RUNTIME, 'corrupt.db')
  seedDatabase(databasePath)
  // 截断到 page1 中间，制造页面级损坏
  writeFileSync(databasePath, readFileSync(databasePath).subarray(0, 2000))

  const logs: string[] = []
  const error = assertThrows(
    () =>
      createDbClient({
        sqlite: createTestSqliteConfig(databasePath),
        logger: createCapturingLogger(logs),
      }),
    'sqlite 数据库无法通过完整性校验',
  )
  assertEquals((error as { code?: string }).code, 'SQLITE_CORRUPT')

  const attributes = (findFatalCorruptRecord(logs).attributes ?? {}) as Record<string, unknown>
  assertEquals(attributes['db.path'], databasePath)
  // error_name / error_message 会被规范化到 OTel exception.type / exception.message
  assertEquals(attributes['exception.type'], 'SQLITE_CORRUPT')
})

test('createDbClient: 非法 sqlite 文件也应中止启动并记录 fatal', () => {
  const databasePath = join(TEST_RUNTIME, 'not-a-db.db')
  writeFileSync(databasePath, 'this is not a sqlite database file at all, just plain text content')

  const logs: string[] = []
  const error = assertThrows(
    () =>
      createDbClient({
        sqlite: createTestSqliteConfig(databasePath),
        logger: createCapturingLogger(logs),
      }),
    'sqlite 数据库无法通过完整性校验',
  )
  assertExists(error)
  findFatalCorruptRecord(logs)
})
