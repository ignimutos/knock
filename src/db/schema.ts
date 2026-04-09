import { createSelectSchema } from 'drizzle-orm/zod'
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id').notNull(),
    itemId: text('item_id').notNull(),
    targetId: text('target_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.sourceId, table.itemId, table.targetId)],
)

export const feeds = sqliteTable('feeds', {
  sourceId: text('source_id').primaryKey(),
  parser: text('parser').notNull(),
  payloadText: text('payload_text').notNull(),
  payloadHash: text('payload_hash').notNull(),
  feedText: text('feed_text').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const entries = sqliteTable(
  'entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id').notNull(),
    entryId: text('entry_id').notNull(),
    entryText: text('entry_text').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    unique().on(table.sourceId, table.entryId),
    index('idx_entries_source_last_seen_at').on(table.sourceId, table.lastSeenAt),
  ],
)

export const deliveryRowSchema = createSelectSchema(deliveries)
export const feedRowSchema = createSelectSchema(feeds)
export const entryRowSchema = createSelectSchema(entries)
