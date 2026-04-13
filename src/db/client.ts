import { dirname } from '@std/path'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite'
import { DatabaseSync } from 'node:sqlite'
import { parseDurationMs } from '../config/runtime_semantics.ts'
import type { SqliteConfigResolved } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import * as factsSchema from '../infrastructure/sqlite/schema.ts'
import * as schema from './schema.ts'

export interface CreateDbClientOptions {
  sqlite: SqliteConfigResolved
  logger?: Logger
}

export type DbClient = NodeSQLiteDatabase<typeof schema> & {
  $client: DatabaseSync
}

export type FactsDbClient = NodeSQLiteDatabase<typeof factsSchema> & {
  $client: DatabaseSync
}

interface TransactionCapableDb {
  $client: DatabaseSync
}

export function runInTransaction<T>(db: TransactionCapableDb, operation: () => T): T {
  db.$client.exec('BEGIN')
  try {
    const result = operation()
    db.$client.exec('COMMIT')
    return result
  } catch (error) {
    db.$client.exec('ROLLBACK')
    throw error
  }
}

export function vacuumDatabaseIfNeeded(
  db: DbClient,
  vacuumMode: 'off' | 'afterPrune',
  shouldVacuum: boolean,
  logger?: Logger,
): void {
  if (vacuumMode !== 'afterPrune' || !shouldVacuum) return
  try {
    db.$client.exec('VACUUM')
  } catch (error) {
    logger?.warn('VACUUM 执行失败，跳过本次压缩', {
      module: 'db.sqlite',
      'db.operation': 'vacuum',
      'db.outcome': 'failure',
      error_name: error instanceof Error ? error.name : 'Error',
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
}

/**
 * 使用 resolved sqlite 配置初始化数据库，确保路径与运行参数只在配置层决定一次。
 */
export function createDbClient(options: CreateDbClientOptions): DbClient {
  const { sqlite } = options
  const { logger } = options
  const databasePath = sqlite.path

  logger?.info('开始初始化 sqlite', {
    module: 'db.sqlite',
    'db.operation': 'init_db',
    'db.outcome': 'start',
    'db.path': databasePath,
  })

  Deno.mkdirSync(dirname(databasePath), { recursive: true })
  const client = new DatabaseSync(databasePath)
  client.exec(`PRAGMA journal_mode=${sqlite.journalMode}`)
  client.exec(`PRAGMA busy_timeout=${parseDurationMs(sqlite.busyTimeout, 'sqlite.busyTimeout')}`)
  const db = drizzle({ client, schema }) as DbClient
  migrate(db, {
    migrationsFolder: new URL('./migrations', import.meta.url).pathname,
  })

  logger?.info('sqlite 初始化完成', {
    module: 'db.sqlite',
    'db.operation': 'init_db',
    'db.outcome': 'success',
    'db.path': databasePath,
  })

  return db
}

export function createFactsDbClient(options: CreateDbClientOptions): FactsDbClient {
  const { sqlite } = options
  const { logger } = options
  const databasePath = sqlite.path

  logger?.info('开始初始化 sqlite facts', {
    module: 'db.sqlite',
    'db.operation': 'init_facts_db',
    'db.outcome': 'start',
    'db.path': databasePath,
  })

  Deno.mkdirSync(dirname(databasePath), { recursive: true })
  const client = new DatabaseSync(databasePath)
  client.exec(`PRAGMA journal_mode=${sqlite.journalMode}`)
  client.exec(`PRAGMA busy_timeout=${parseDurationMs(sqlite.busyTimeout, 'sqlite.busyTimeout')}`)
  factsSchema.initializeSqliteFactsSchema(client)
  const db = drizzle({ client, schema: factsSchema }) as FactsDbClient

  logger?.info('sqlite facts 初始化完成', {
    module: 'db.sqlite',
    'db.operation': 'init_facts_db',
    'db.outcome': 'success',
    'db.path': databasePath,
  })

  return db
}

export function createInMemoryDb(): FactsDbClient {
  const client = new DatabaseSync(':memory:')
  factsSchema.initializeSqliteFactsSchema(client)
  return drizzle({ client, schema: factsSchema }) as FactsDbClient
}
