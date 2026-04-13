import { and, asc, desc, eq, gt, lte } from 'drizzle-orm'
import type { UnifiedFeedFields } from '../../config/types.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { pipelineItems, sourceRuns } from './schema.ts'

export interface SummaryInputWindow {
  after: string
  atOrBefore: string
}

export interface SummarySourceInput {
  name: string
  feed: Record<string, unknown>
  entries: Record<string, unknown>[]
}

export interface SummaryQueryService {
  getSummaryCheckpoint(
    sourceId: string,
    effectDomain: 'production' | 'preview',
  ): Promise<string | undefined>
  getSummaryInputs(
    sourceIds: string[],
    window: SummaryInputWindow,
    effectDomain: 'production' | 'preview',
  ): Promise<Record<string, SummarySourceInput>>
}

function parseJsonRecord(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function toSummarySourceInput(feed?: UnifiedFeedFields): SummarySourceInput {
  return {
    name: feed?.title ?? '',
    feed: feed ? { ...feed } : {},
    entries: [],
  }
}

function toFeedSnapshot(row: { feedJson: string | null }): UnifiedFeedFields | undefined {
  const parsed = parseJsonRecord(row.feedJson)
  if (!parsed) return undefined
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    link: typeof parsed.link === 'string' ? parsed.link : '',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    generator: typeof parsed.generator === 'string' ? parsed.generator : '',
    language: typeof parsed.language === 'string' ? parsed.language : '',
    published: typeof parsed.published === 'string' ? parsed.published : '',
  }
}

export function createSummaryQueryService(db: FactsDbClient): SummaryQueryService {
  return {
    getSummaryCheckpoint(sourceId, effectDomain) {
      const row = db
        .select({ finishedAt: sourceRuns.finishedAt, startedAt: sourceRuns.startedAt })
        .from(sourceRuns)
        .where(
          and(
            eq(sourceRuns.sourceId, sourceId),
            eq(sourceRuns.effectDomain, effectDomain),
            eq(sourceRuns.status, 'success'),
          ),
        )
        .orderBy(desc(sourceRuns.finishedAt), desc(sourceRuns.startedAt))
        .get()

      return Promise.resolve(row?.finishedAt ?? row?.startedAt)
    },

    getSummaryInputs(sourceIds, window, effectDomain) {
      const result = Object.fromEntries(
        sourceIds.map((sourceId) => [sourceId, toSummarySourceInput()]),
      ) as Record<string, SummarySourceInput>

      for (const sourceId of sourceIds) {
        const latestRun = db
          .select({ feedJson: sourceRuns.feedJson })
          .from(sourceRuns)
          .where(
            and(
              eq(sourceRuns.sourceId, sourceId),
              eq(sourceRuns.effectDomain, effectDomain),
              eq(sourceRuns.status, 'success'),
            ),
          )
          .orderBy(desc(sourceRuns.finishedAt), desc(sourceRuns.startedAt))
          .get()

        result[sourceId] = toSummarySourceInput(toFeedSnapshot(latestRun ?? { feedJson: null }))
      }

      const itemRows = db
        .select({
          sourceId: pipelineItems.sourceId,
          normalizedJson: pipelineItems.normalizedJson,
        })
        .from(pipelineItems)
        .innerJoin(sourceRuns, eq(sourceRuns.runId, pipelineItems.sourceRunId))
        .where(
          and(
            gt(sourceRuns.finishedAt, window.after),
            lte(sourceRuns.finishedAt, window.atOrBefore),
            eq(sourceRuns.effectDomain, effectDomain),
            eq(sourceRuns.status, 'success'),
            eq(pipelineItems.effectDomain, effectDomain),
            eq(pipelineItems.status, 'delivered'),
          ),
        )
        .orderBy(asc(sourceRuns.finishedAt), asc(pipelineItems.itemId))
        .all()

      for (const row of itemRows) {
        if (!sourceIds.includes(row.sourceId)) continue
        const parsed = parseJsonRecord(row.normalizedJson)
        if (!parsed) continue
        result[row.sourceId]?.entries.push(parsed)
      }

      return Promise.resolve(result)
    },
  }
}
