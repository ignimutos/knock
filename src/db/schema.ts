import type { SqliteDatabase } from '../platform/sqlite.ts'

const LEGACY_SQLITE_MIGRATION_HASH = '20260328192000_init'
const LEGACY_SQLITE_MIGRATION_CREATED_AT = Date.parse('2026-03-28T19:20:00.000Z')

const SQLITE_RUNTIME_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at NUMERIC NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, item_id, target_id)
  )`,
  `CREATE TABLE IF NOT EXISTS feeds (
    source_id TEXT PRIMARY KEY,
    parser TEXT NOT NULL,
    payload_text TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    feed_text TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    entry_text TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, entry_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_entries_source_last_seen_at ON entries(source_id, last_seen_at)',
] as const

export function initializeSqliteRuntimeSchema(client: SqliteDatabase): void {
  for (const statement of SQLITE_RUNTIME_SCHEMA_SQL) {
    client.exec(statement)
  }

  const existingMigration = client
    .prepare('SELECT 1 AS ok FROM __drizzle_migrations WHERE hash = ? LIMIT 1')
    .get(LEGACY_SQLITE_MIGRATION_HASH)

  if (existingMigration) {
    return
  }

  client
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(LEGACY_SQLITE_MIGRATION_HASH, LEGACY_SQLITE_MIGRATION_CREATED_AT)
}
