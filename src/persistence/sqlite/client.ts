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

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Error && typeof (error as { code?: string }).code === 'string'
    ? (error as { code?: string }).code
    : undefined
}

function errorReasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 判断失败是否属于“数据库文件损坏/非法”这类可通过删除重建恢复的问题；
 * 权限、路径等环境性打开失败不属于此类，应保留原始错误。
 */
function isCorruptionError(code: string | undefined, reason: string): boolean {
  return (
    code === 'SQLITE_CORRUPT' ||
    code === 'SQLITE_NOTADB' ||
    /malformed|not a database/i.test(reason)
  )
}

/**
 * 底层驱动可能不总是给错误附带 code，用 reason 语义兜底推导稳定错误码。
 */
function inferCorruptionCode(reason: string): string {
  return /not a database/i.test(reason) ? 'SQLITE_NOTADB' : 'SQLITE_CORRUPT'
}

function failCorruptDatabase(
  databasePath: string,
  code: string | undefined,
  reason: string,
  logger?: Logger,
): never {
  const report = new Error(
    `sqlite 数据库无法通过完整性校验（${reason}）。该库是派生缓存数据：请先备份，` +
      '再删除该文件（连同同名 -wal / -shm）并重启重建，或从备份恢复。' +
      '若在容器或挂载环境反复出现，建议显式配置 sqlite.journalMode: DELETE，' +
      '并保证单实例运行、数据库位于可靠持久卷上、进程优雅停止。',
  )
  const effectiveCode = code ?? inferCorruptionCode(reason)
  ;(report as { code?: string }).code = effectiveCode

  logger?.fatal('sqlite 数据库损坏，已中止启动', {
    module: 'db.sqlite',
    'db.operation': 'init_db',
    'db.outcome': 'failure',
    'db.integrity': 'corrupt',
    'db.path': databasePath,
    error_name: effectiveCode,
    error_message: reason,
  })

  throw report
}

/**
 * 返回首次检测到的页面级完整性问题；无问题时返回 null。
 */
function detectIntegrityProblem(
  client: SqliteDatabase,
): { code: string | undefined; reason: string } | null {
  try {
    const rows = client.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check?: unknown
    }>
    const badLines = rows
      .map((row) => (typeof row.integrity_check === 'string' ? row.integrity_check : ''))
      .filter((line) => line !== '' && line !== 'ok')
    if (badLines.length === 0) return null
    return { code: 'SQLITE_CORRUPT', reason: badLines.join('; ') }
  } catch (error) {
    const code = errorCodeOf(error)
    const reason = errorReasonOf(error)
    if (!isCorruptionError(code, reason)) throw error
    return { code, reason }
  }
}

/**
 * 打开 sqlite 并立即做一次页面级完整性校验。facts 库是派生缓存数据，一旦损坏应在启动早期
 * 给出可执行报错并退出，而不是延迟到 schema / prune 写入阶段抛裸 SQLITE_CORRUPT。
 * 校验放在 journal_mode / schema 写入之前，避免对已损坏的文件追加写入。
 */
function openAndVerifyFactsDatabase(databasePath: string, logger?: Logger): SqliteDatabase {
  let client: SqliteDatabase
  try {
    client = openSqliteDatabase(databasePath)
  } catch (error) {
    const code = errorCodeOf(error)
    const reason = errorReasonOf(error)
    if (isCorruptionError(code, reason)) {
      failCorruptDatabase(databasePath, code, reason, logger)
    }
    throw error
  }

  const problem = detectIntegrityProblem(client)
  if (problem !== null) {
    client.close()
    failCorruptDatabase(databasePath, problem.code, problem.reason, logger)
  }
  return client
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
  const client = openAndVerifyFactsDatabase(databasePath, logger)
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
