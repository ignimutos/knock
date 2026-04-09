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
}

export type DeliverIfNeededResult = 'deduped' | 'delivered'

export interface SourceStateStore {
  persistParsedSource(input: PersistParsedSourceInput): Promise<void>
  deliverIfNeeded(
    sourceId: string,
    itemId: string,
    deliveryId: string,
    push: () => void | Promise<void>,
  ): Promise<DeliverIfNeededResult>
  pruneSourceState(sourceId: string, activeDeliveryCount: number): void
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
): void {
  const now = new Date().toISOString()

  runInTransaction(db, () => {
    for (const parsedEntry of parsedEntries) {
      const entryId = normalizeEntryId(parsedEntry.mapped.id)
      if (!entryId) continue
      db.update(entries).set({ lastSeenAt: now }).where(entryIdentityWhere(sourceId, entryId)).run()
    }
  })
}

function storeParsedContent(
  db: DbClient,
  input: PersistParsedSourceInput & { payloadHash: string },
): void {
  const now = new Date().toISOString()
  const feedText = stringifyStoredContent(input.feedMapped)

  runInTransaction(db, () => {
    db.insert(feeds)
      .values({
        sourceId: input.sourceId,
        parser: input.parser,
        payloadText: input.payload,
        payloadHash: input.payloadHash,
        feedText,
        fetchedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: feeds.sourceId,
        set: {
          parser: input.parser,
          payloadText: input.payload,
          payloadHash: input.payloadHash,
          feedText,
          fetchedAt: now,
          updatedAt: now,
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
            firstSeenAt: now,
            lastSeenAt: now,
            updatedAt: now,
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
      const shouldUpdate = nextUpdated
        ? existingUpdated !== nextUpdated
        : existingEntry.entryText !== entryText

      if (shouldUpdate) {
        db.update(entries)
          .set({ entryText, lastSeenAt: now, updatedAt: now })
          .where(entryIdentityWhere(input.sourceId, entryId))
          .run()
      } else {
        db.update(entries)
          .set({ lastSeenAt: now })
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

export function createSourceStateStore(options: CreateSourceStateStoreOptions): SourceStateStore {
  const { db, sqlite, logger } = options

  return {
    async persistParsedSource(input: PersistParsedSourceInput): Promise<void> {
      const payloadHash = await hashPayload(input.payload)
      if (shouldStoreParsedContent(db, input.sourceId, payloadHash)) {
        storeParsedContent(db, { ...input, payloadHash })
        return
      }

      touchSeenEntries(db, input.sourceId, input.entries)
    },

    async deliverIfNeeded(
      sourceId: string,
      itemId: string,
      deliveryId: string,
      push: () => void | Promise<void>,
    ): Promise<DeliverIfNeededResult> {
      if (isDelivered(db, sourceId, itemId, deliveryId)) {
        return 'deduped'
      }

      await push()
      markDelivered(db, sourceId, itemId, deliveryId)
      return 'delivered'
    },

    pruneSourceState(sourceId: string, activeDeliveryCount: number): void {
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

      vacuumDatabaseIfNeeded(db, sqlite.retention.vacuum, deliveriesPruned || entriesPruned, logger)
    },
  }
}
