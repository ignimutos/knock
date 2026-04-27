import type { UnifiedFeedFields } from '../../config/types.ts'
import type { FactsDbClient } from '../../db/client.ts'

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
      const row = db.$client
        .prepare(
          `
            SELECT
              finished_at AS finishedAt,
              started_at AS startedAt
            FROM source_runs
            WHERE source_id = ?
              AND effect_domain = ?
              AND status = 'success'
            ORDER BY finished_at DESC, started_at DESC
            LIMIT 1
          `,
        )
        .get(sourceId, effectDomain) as
        | {
            finishedAt: string | null
            startedAt: string
          }
        | undefined

      return Promise.resolve(row?.finishedAt ?? row?.startedAt)
    },

    getSummaryInputs(sourceIds, window, effectDomain) {
      const result = Object.fromEntries(
        sourceIds.map((sourceId) => [sourceId, toSummarySourceInput()]),
      ) as Record<string, SummarySourceInput>

      const latestRunQuery = db.$client.prepare(
        `
          SELECT feed_json AS feedJson
          FROM source_runs
          WHERE source_id = ?
            AND effect_domain = ?
            AND status = 'success'
          ORDER BY finished_at DESC, started_at DESC
          LIMIT 1
        `,
      )

      for (const sourceId of sourceIds) {
        const latestRun = latestRunQuery.get(sourceId, effectDomain) as
          | { feedJson: string | null }
          | undefined

        result[sourceId] = toSummarySourceInput(toFeedSnapshot(latestRun ?? { feedJson: null }))
      }

      const itemRows = db.$client
        .prepare(
          `
            SELECT
              pipeline_items.source_id AS sourceId,
              pipeline_items.normalized_json AS normalizedJson
            FROM pipeline_items
            INNER JOIN source_runs ON source_runs.run_id = pipeline_items.source_run_id
            WHERE source_runs.finished_at > ?
              AND source_runs.finished_at <= ?
              AND source_runs.effect_domain = ?
              AND source_runs.status = 'success'
              AND pipeline_items.effect_domain = ?
              AND pipeline_items.status = 'delivered'
            ORDER BY source_runs.finished_at ASC, pipeline_items.item_id ASC
          `,
        )
        .all(window.after, window.atOrBefore, effectDomain, effectDomain) as Array<{
        sourceId: string
        normalizedJson: string
      }>

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
