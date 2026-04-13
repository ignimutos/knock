import { foreignKey, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type { DatabaseSync } from 'node:sqlite'

export const sourceRuns = sqliteTable(
  'source_runs',
  {
    runId: text('run_id').primaryKey(),
    sourceId: text('source_id').notNull(),
    trigger: text('trigger').notNull(),
    profile: text('profile').notNull(),
    effectDomain: text('effect_domain').notNull(),
    status: text('status').notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    countsJson: text('counts_json').notNull(),
    feedJson: text('feed_json'),
  },
  (table) => [
    index('idx_source_runs_source_started_at').on(table.sourceId, table.startedAt),
    unique('uq_source_runs_run_domain').on(table.runId, table.effectDomain),
  ],
)

export const pipelineItems = sqliteTable(
  'pipeline_items',
  {
    itemId: text('item_id').primaryKey(),
    sourceRunId: text('source_run_id').notNull(),
    sourceId: text('source_id').notNull(),
    effectDomain: text('effect_domain').notNull(),
    normalizedJson: text('normalized_json').notNull(),
    status: text('status').notNull(),
    skippedReason: text('skipped_reason'),
  },
  (table) => [
    index('idx_pipeline_items_run_id').on(table.sourceRunId),
    foreignKey({
      columns: [table.sourceRunId, table.effectDomain],
      foreignColumns: [sourceRuns.runId, sourceRuns.effectDomain],
    }),
    unique('uq_pipeline_items_run_item').on(table.sourceRunId, table.itemId),
    unique('uq_pipeline_items_item_domain').on(table.itemId, table.effectDomain),
    unique('uq_pipeline_items_run_item_domain').on(
      table.sourceRunId,
      table.itemId,
      table.effectDomain,
    ),
  ],
)

export const deliveryAttempts = sqliteTable(
  'delivery_attempts',
  {
    attemptId: text('attempt_id').primaryKey(),
    itemId: text('item_id').notNull(),
    sourceRunId: text('source_run_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    channel: text('channel').notNull(),
    effectDomain: text('effect_domain').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    renderedSnapshotJson: text('rendered_snapshot_json'),
    plannedAt: text('planned_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('idx_delivery_attempts_run_id').on(table.sourceRunId),
    index('idx_delivery_attempts_item_id').on(table.itemId),
    foreignKey({
      columns: [table.sourceRunId, table.effectDomain],
      foreignColumns: [sourceRuns.runId, sourceRuns.effectDomain],
    }),
    foreignKey({
      columns: [table.itemId, table.effectDomain],
      foreignColumns: [pipelineItems.itemId, pipelineItems.effectDomain],
    }),
    foreignKey({
      columns: [table.sourceRunId, table.itemId, table.effectDomain],
      foreignColumns: [pipelineItems.sourceRunId, pipelineItems.itemId, pipelineItems.effectDomain],
    }),
  ],
)

export const deduplications = sqliteTable(
  'deduplications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deduplicationKey: text('deduplication_key').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    effectDomain: text('effect_domain').notNull(),
    fingerprint: text('fingerprint').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [
    unique().on(table.deduplicationKey),
    index('idx_deduplications_lookup').on(
      table.effectDomain,
      table.scope,
      table.scopeId,
      table.fingerprint,
    ),
  ],
)

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
