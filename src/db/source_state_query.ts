import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm'
import type { DbClient } from './client.ts'
import { entries, feeds } from './schema.ts'

export interface SummaryInputWindow {
  after: string
  atOrBefore: string
}

export interface SummarySourceInput {
  name: string
  feed: Record<string, unknown>
  entries: Record<string, unknown>[]
}

export interface SourceStateQuery {
  getSummaryCheckpoint(sourceId: string): Promise<string | undefined>
  getSummaryInputs(
    sourceIds: string[],
    window: SummaryInputWindow,
  ): Promise<Record<string, SummarySourceInput>>
}

export interface CreateSourceStateQueryOptions {
  db: DbClient
}

function parseStoredJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createSourceStateQuery(options: CreateSourceStateQueryOptions): SourceStateQuery {
  const { db } = options

  return {
    getSummaryCheckpoint(sourceId: string): Promise<string | undefined> {
      const row = db
        .select({ updatedAt: feeds.updatedAt, fetchedAt: feeds.fetchedAt })
        .from(feeds)
        .where(eq(feeds.sourceId, sourceId))
        .get()

      return Promise.resolve(row?.updatedAt ?? row?.fetchedAt)
    },

    getSummaryInputs(
      sourceIds: string[],
      window: SummaryInputWindow,
    ): Promise<Record<string, SummarySourceInput>> {
      if (sourceIds.length === 0) return Promise.resolve({})

      const feedRows = db
        .select({ sourceId: feeds.sourceId, feedText: feeds.feedText })
        .from(feeds)
        .where(inArray(feeds.sourceId, sourceIds))
        .all()

      const result = Object.fromEntries(
        sourceIds.map((sourceId) => [
          sourceId,
          {
            name: '',
            feed: {},
            entries: [],
          },
        ]),
      ) as Record<string, SummarySourceInput>

      for (const row of feedRows) {
        const feed = parseStoredJson(row.feedText)
        if (!feed) continue
        result[row.sourceId] = {
          ...result[row.sourceId],
          name: typeof feed.title === 'string' ? feed.title : '',
          feed,
        }
      }

      const entryRows = db
        .select({
          sourceId: entries.sourceId,
          entryText: entries.entryText,
          lastSeenAt: entries.lastSeenAt,
        })
        .from(entries)
        .where(
          and(
            inArray(entries.sourceId, sourceIds),
            gt(entries.lastSeenAt, window.after),
            lte(entries.lastSeenAt, window.atOrBefore),
          ),
        )
        .orderBy(asc(entries.lastSeenAt), asc(entries.id))
        .all()

      for (const row of entryRows) {
        const entry = parseStoredJson(row.entryText)
        if (!entry) continue
        result[row.sourceId]?.entries.push(entry)
      }

      return Promise.resolve(result)
    },
  }
}
