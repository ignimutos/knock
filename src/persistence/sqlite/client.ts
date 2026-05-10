import { dirname } from 'node:path'
import { parseDurationMs } from '../../config/runtime_semantics.ts'
import type { SqliteConfigResolved } from '../../config/types.ts'
import type { Logger } from '../../core/logger.ts'
import { initializeSqliteFactsSchema } from './schema.ts'
import { mkdirPathSync } from '../../platform/fs.ts'
import { openSqliteDatabase, type SqliteDatabase } from '../../platform/sqlite.ts'

export interface CreateDbClientOptions {
  sqlite: SqliteConfigResolved
  logger?: Logger
}

export interface DbClient {
  $client: SqliteDatabase
}

export type FactsDbClient = DbClient

interface TransactionCapableDb {
  $client: SqliteDatabase
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

  mkdirPathSync(dirname(databasePath), { recursive: true })
  const client = openSqliteDatabase(databasePath)
  client.exec(`PRAGMA busy_timeout=${parseDurationMs(sqlite.busyTimeout, 'sqlite.busyTimeout')}`)
  client.exec(`PRAGMA journal_mode=${sqlite.journalMode}`)
  initializeSqliteFactsSchema(client)

  logger?.info('sqlite 初始化完成', {
    module: 'db.sqlite',
    'db.operation': 'init_db',
    'db.outcome': 'success',
    'db.path': databasePath,
  })

  return { $client: client }
}

export function createInMemoryDb(): DbClient {
  const client = openSqliteDatabase(':memory:')
  initializeSqliteFactsSchema(client)
  return { $client: client }
}
