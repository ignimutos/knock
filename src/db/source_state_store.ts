import { and, eq, lt, sql } from 'drizzle-orm'
import { parseDurationMs } from '../config/runtime_semantics.ts'
import type { SqliteConfigResolved } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import type { ParsedSourceEntry, ParsedSourceResult } from '../sources/source_runtime.ts'
import type { UnifiedEntryFields, UnifiedFeedFields } from '../config/types.ts'
import { type DbClient, runInTransaction, vacuumDatabaseIfNeeded } from './client.ts'
import { deliveries, entries, feeds } from './schema.ts'

export interface PersistParsedSourceInput {
  sourceId: string
  parser: ParsedSourceResult['parser']
  payload: string
  feedMapped: ParsedSourceResult['feedMapped']
  entries: ParsedSourceEntry[]
  observedAt?: string
}

export type DeliverIfNeededResult = 'deduped' | 'delivered'

export interface SourceStateStore {
  persistParsedSource(input: PersistParsedSourceInput, sourceRunId?: string): Promise<void>
  deliverIfNeeded(
    sourceId: string,
    itemId: string,
    deliveryId: string,
    push: () => void | Promise<void>,
    sourceRunId?: string,
  ): Promise<DeliverIfNeededResult>
  pruneSourceState(sourceId: string, activeDeliveryCount: number, sourceRunId?: string): void
}

export interface CreateSourceStateStoreOptions {
  db: DbClient
  sqlite: SqliteConfigResolved
  logger?: Logger
}

function stringifyStoredContent(
  value: Record<string, string> | UnifiedFeedFields | UnifiedEntryFields,
): string {
  return JSON.stringify(value)
}

function normalizeEntryId(value: unknown): string {
  return `${value ?? ''}`.trim()
}

function entryIdentityWhere(sourceId: string, entryId: string) {
  return and(eq(entries.sourceId, sourceId), eq(entries.entryId, entryId))
}

async function hashPayload(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function shouldStoreParsedContent(db: DbClient, sourceId: string, payloadHash: string): boolean {
  const existingFeed = db
    .select({ payloadHash: feeds.payloadHash })
    .from(feeds)
    .where(eq(feeds.sourceId, sourceId))
    .get()

  return existingFeed?.payloadHash !== payloadHash
}

function touchSeenEntries(
  db: DbClient,
  sourceId: string,
  parsedEntries: ParsedSourceEntry[],
  observedAt: string,
): void {
  runInTransaction(db, () => {
    for (const parsedEntry of parsedEntries) {
      const entryId = normalizeEntryId(parsedEntry.mapped.id)
      if (!entryId) continue
      db.update(entries)
        .set({ lastSeenAt: observedAt })
        .where(entryIdentityWhere(sourceId, entryId))
        .run()
    }
  })
}

function storeParsedContent(
  db: DbClient,
  input: PersistParsedSourceInput & { payloadHash: string; observedAt: string },
): void {
  const feedText = stringifyStoredContent(input.feedMapped)

  runInTransaction(db, () => {
    db.insert(feeds)
      .values({
        sourceId: input.sourceId,
        parser: input.parser,
        payloadText: input.payload,
        payloadHash: input.payloadHash,
        feedText,
        fetchedAt: input.observedAt,
        updatedAt: input.observedAt,
      })
      .onConflictDoUpdate({
        target: feeds.sourceId,
        set: {
          parser: input.parser,
          payloadText: input.payload,
          payloadHash: input.payloadHash,
          feedText,
          fetchedAt: input.observedAt,
          updatedAt: input.observedAt,
        },
      })
      .run()

    for (const parsedEntry of input.entries) {
      const entryId = normalizeEntryId(parsedEntry.mapped.id)
      if (!entryId) continue
      const entryText = stringifyStoredContent(parsedEntry.mapped)
      const existingEntry = db
        .select({ entryText: entries.entryText })
        .from(entries)
        .where(entryIdentityWhere(input.sourceId, entryId))
        .get()
      if (!existingEntry) {
        db.insert(entries)
          .values({
            sourceId: input.sourceId,
            entryId,
            entryText,
            firstSeenAt: input.observedAt,
            lastSeenAt: input.observedAt,
            updatedAt: input.observedAt,
          })
          .run()
        continue
      }

      const existingUpdated = (() => {
        try {
          return String(
            (JSON.parse(existingEntry.entryText ?? '{}') as Record<string, unknown>).updated ?? '',
          )
        } catch {
          return ''
        }
      })()
      const nextUpdated = String(parsedEntry.mapped.updated ?? '')
      const shouldUpdate = existingEntry.entryText !== entryText || existingUpdated !== nextUpdated

      if (shouldUpdate) {
        db.update(entries)
          .set({ entryText, lastSeenAt: input.observedAt, updatedAt: input.observedAt })
          .where(entryIdentityWhere(input.sourceId, entryId))
          .run()
      } else {
        db.update(entries)
          .set({ lastSeenAt: input.observedAt })
          .where(entryIdentityWhere(input.sourceId, entryId))
          .run()
      }
    }
  })
}

function isDelivered(db: DbClient, sourceId: string, itemId: string, deliveryId: string): boolean {
  const latestDelivery = db
    .select({ status: deliveries.status })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.sourceId, sourceId),
        eq(deliveries.itemId, itemId),
        eq(deliveries.targetId, deliveryId),
      ),
    )
    .get()

  return latestDelivery?.status === 'delivered'
}

function markDelivered(db: DbClient, sourceId: string, itemId: string, deliveryId: string): void {
  const deliveredAt = new Date().toISOString()
  db.insert(deliveries)
    .values({
      sourceId,
      itemId,
      targetId: deliveryId,
      status: 'delivered',
      createdAt: deliveredAt,
    })
    .onConflictDoUpdate({
      target: [deliveries.sourceId, deliveries.itemId, deliveries.targetId],
      set: {
        status: 'delivered',
        createdAt: deliveredAt,
      },
    })
    .run()
}

function pruneEntries(
  db: DbClient,
  input: {
    sourceId: string
    maxAge: string
    maxEntriesPerSource: number
  },
): boolean {
  const maxAgeMs = Date.now() - parseDurationMs(input.maxAge, 'sqlite.retention.maxAge')
  const expiresBefore = new Date(maxAgeMs).toISOString()
  let pruned = false

  const expiredResult = db
    .delete(entries)
    .where(and(eq(entries.sourceId, input.sourceId), lt(entries.lastSeenAt, expiresBefore)))
    .run()
  if ((expiredResult.changes ?? 0) > 0) pruned = true

  const overflowResult = db
    .delete(entries)
    .where(
      sql`
    ${entries.id} in (
      select ${entries.id}
      from ${entries}
      where ${entries.sourceId} = ${input.sourceId}
      order by ${entries.lastSeenAt} desc
      limit -1 offset ${input.maxEntriesPerSource}
    )
  `,
    )
    .run()
  if ((overflowResult.changes ?? 0) > 0) pruned = true

  return pruned
}

function pruneDeliveries(
  db: DbClient,
  input: {
    sourceId: string
    maxAge: string
    maxEntriesPerSource: number
    activeDeliveryCount: number
  },
): boolean {
  const maxAgeMs = parseDurationMs(input.maxAge, 'sqlite.retention.maxAge')
  const expiresBefore = new Date(Date.now() - maxAgeMs).toISOString()
  let pruned = false

  const expiredResult = db
    .delete(deliveries)
    .where(and(eq(deliveries.sourceId, input.sourceId), lt(deliveries.createdAt, expiresBefore)))
    .run()
  if ((expiredResult.changes ?? 0) > 0) pruned = true

  const maxRows = input.maxEntriesPerSource * input.activeDeliveryCount
  const overflowResult = db
    .delete(deliveries)
    .where(
      sql`
        ${deliveries.id} in (
          select ${deliveries.id}
          from ${deliveries}
          where ${deliveries.sourceId} = ${input.sourceId}
          order by ${deliveries.createdAt} desc
          limit -1 offset ${maxRows}
        )
      `,
    )
    .run()
  if ((overflowResult.changes ?? 0) > 0) pruned = true

  return pruned
}

function getStoreLogFields(
  sourceId: string,
  sourceRunId?: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    module: 'db.state.store',
    'source.id': sourceId,
    ...(sourceRunId ? { 'source.run_id': sourceRunId } : {}),
    ...fields,
  }
}

export function createSourceStateStore(options: CreateSourceStateStoreOptions): SourceStateStore {
  const { db, sqlite, logger } = options

  return {
    async persistParsedSource(
      input: PersistParsedSourceInput,
      sourceRunId?: string,
    ): Promise<void> {
      const observedAt = input.observedAt ?? new Date().toISOString()
      const payloadHash = await hashPayload(input.payload)
      if (shouldStoreParsedContent(db, input.sourceId, payloadHash)) {
        storeParsedContent(db, { ...input, payloadHash, observedAt })
        logger?.info('source 状态已持久化', {
          ...getStoreLogFields(input.sourceId, sourceRunId, {
            'db.operation': 'persist_source_state',
            'db.outcome': 'stored',
            'source.parser': input.parser,
            'source.item_count': input.entries.length,
          }),
        })
        return
      }

      touchSeenEntries(db, input.sourceId, input.entries, observedAt)
      logger?.info('source 状态未变化，仅刷新 last_seen', {
        ...getStoreLogFields(input.sourceId, sourceRunId, {
          'db.operation': 'persist_source_state',
          'db.outcome': 'touched_seen_entries',
          'source.parser': input.parser,
          'source.item_count': input.entries.length,
        }),
      })
    },

    async deliverIfNeeded(
      sourceId: string,
      itemId: string,
      deliveryId: string,
      push: () => void | Promise<void>,
      sourceRunId?: string,
    ): Promise<DeliverIfNeededResult> {
      if (isDelivered(db, sourceId, itemId, deliveryId)) {
        logger?.info('命中已投递记录', {
          ...getStoreLogFields(sourceId, sourceRunId, {
            'db.operation': 'dedupe_check',
            'db.outcome': 'deduped',
            'pipeline.item_id': itemId,
            'delivery.id': deliveryId,
          }),
        })
        return 'deduped'
      }

      await push()
      markDelivered(db, sourceId, itemId, deliveryId)
      logger?.info('记录 delivered 状态', {
        ...getStoreLogFields(sourceId, sourceRunId, {
          'db.operation': 'mark_delivered',
          'db.outcome': 'success',
          'pipeline.item_id': itemId,
          'delivery.id': deliveryId,
        }),
      })
      return 'delivered'
    },

    pruneSourceState(sourceId: string, activeDeliveryCount: number, sourceRunId?: string): void {
      const deliveriesPruned = pruneDeliveries(db, {
        sourceId,
        maxAge: sqlite.retention.maxAge,
        maxEntriesPerSource: sqlite.retention.maxEntriesPerSource,
        activeDeliveryCount,
      })
      const entriesPruned = pruneEntries(db, {
        sourceId,
        maxAge: sqlite.retention.maxAge,
        maxEntriesPerSource: sqlite.retention.maxEntriesPerSource,
      })

      logger?.info('source 状态清理完成', {
        ...getStoreLogFields(sourceId, sourceRunId, {
          'db.operation': 'prune_source_state',
          'db.outcome': deliveriesPruned || entriesPruned ? 'pruned' : 'unchanged',
          'db.pruned_entries': entriesPruned,
          'db.pruned_deliveries': deliveriesPruned,
          'delivery.active_count': activeDeliveryCount,
        }),
      })

      vacuumDatabaseIfNeeded(db, sqlite.retention.vacuum, deliveriesPruned || entriesPruned, logger)
    },
  }
}
