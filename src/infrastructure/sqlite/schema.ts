import type { DatabaseSync } from 'node:sqlite'

export const SOURCE_RUN_STATUSES = [
  'planned',
  'running',
  'success',
  'partial',
  'failed',
  'skipped',
  'interrupted',
] as const

export const PIPELINE_ITEM_STATUSES = [
  'ready',
  'filtered',
  'duplicate',
  'skipped',
  'delivered',
  'failed',
] as const

export const PIPELINE_ITEM_SKIPPED_REASONS = ['all_deliveries_duplicate', 'no_deliveries'] as const

export const DELIVERY_CHANNELS = ['file', 'push', 'email'] as const

export const DELIVERY_ATTEMPT_STATUSES = [
  'planned',
  'running',
  'delivered',
  'failed',
  'skipped',
  'interrupted',
] as const

export const EFFECT_DOMAINS = ['production', 'preview'] as const
export const RUN_TRIGGERS = ['scheduled', 'immediate', 'manual', 'preview'] as const
export const RUN_PROFILES = ['production', 'preview'] as const
export const DEDUPLICATION_SCOPES = ['item', 'delivery'] as const

const SQLITE_FACTS_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS source_runs (
    run_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    profile TEXT NOT NULL,
    effect_domain TEXT NOT NULL,
    status TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    counts_json TEXT NOT NULL,
    feed_json TEXT,
    UNIQUE(run_id, effect_domain)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_source_runs_source_started_at ON source_runs(source_id, started_at)',
  `CREATE TABLE IF NOT EXISTS pipeline_items (
    item_id TEXT PRIMARY KEY,
    source_run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    effect_domain TEXT NOT NULL,
    normalized_json TEXT NOT NULL,
    status TEXT NOT NULL,
    skipped_reason TEXT,
    FOREIGN KEY (source_run_id, effect_domain) REFERENCES source_runs(run_id, effect_domain),
    UNIQUE(source_run_id, item_id),
    UNIQUE(item_id, effect_domain),
    UNIQUE(source_run_id, item_id, effect_domain)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_pipeline_items_run_id ON pipeline_items(source_run_id)',
  `CREATE TABLE IF NOT EXISTS delivery_attempts (
    attempt_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    effect_domain TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    rendered_snapshot_json TEXT,
    planned_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (source_run_id, effect_domain) REFERENCES source_runs(run_id, effect_domain),
    FOREIGN KEY (item_id, effect_domain) REFERENCES pipeline_items(item_id, effect_domain),
    FOREIGN KEY (source_run_id, item_id, effect_domain) REFERENCES pipeline_items(source_run_id, item_id, effect_domain)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_delivery_attempts_run_id ON delivery_attempts(source_run_id)',
  'CREATE INDEX IF NOT EXISTS idx_delivery_attempts_item_id ON delivery_attempts(item_id)',
  `CREATE TABLE IF NOT EXISTS deduplications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deduplication_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    effect_domain TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(deduplication_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_deduplications_lookup ON deduplications(effect_domain, scope, scope_id, fingerprint)',
] as const

export function initializeSqliteFactsSchema(client: DatabaseSync): void {
  client.exec('PRAGMA foreign_keys = ON')

  for (const statement of SQLITE_FACTS_SCHEMA_SQL) {
    client.exec(statement)
  }
}
