CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, item_id, target_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feeds (
  source_id TEXT PRIMARY KEY,
  parser TEXT NOT NULL,
  payload_text TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  feed_text TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  entry_text TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, entry_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_entries_source_last_seen_at ON entries(source_id, last_seen_at);
