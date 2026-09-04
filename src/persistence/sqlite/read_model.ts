import type { FactsDbClient } from './client.ts'
import type { FactsReadModel, SummarySourceInput } from '../read_model.ts'

function parseSummaryJsonRecord(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function toSummarySourceInput(feedJson: string | null): SummarySourceInput {
  const parsed = parseSummaryJsonRecord(feedJson)
  return {
    name: typeof parsed?.title === 'string' ? parsed.title : '',
    feed: parsed
      ? {
          title: typeof parsed.title === 'string' ? parsed.title : '',
          link: typeof parsed.link === 'string' ? parsed.link : '',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          generator: typeof parsed.generator === 'string' ? parsed.generator : '',
          language: typeof parsed.language === 'string' ? parsed.language : '',
          published: typeof parsed.published === 'string' ? parsed.published : '',
        }
      : {},
    entries: [],
  }
}

export function createSqliteReadModel(db: FactsDbClient): FactsReadModel {
  const getSummaryCheckpointQuery = db.$client.prepare(`
    SELECT
      finished_at AS finishedAt,
      started_at AS startedAt
    FROM source_runs
    WHERE source_id = ?
      AND effect_domain = ?
      AND status = 'success'
    ORDER BY finished_at DESC, started_at DESC
    LIMIT 1
  `)

  const getSummaryLatestRunQuery = db.$client.prepare(`
    SELECT feed_json AS feedJson
    FROM source_runs
    WHERE source_id = ?
      AND effect_domain = ?
      AND status = 'success'
    ORDER BY finished_at DESC, started_at DESC
    LIMIT 1
  `)

  const getSummaryItemsQuery = db.$client.prepare(`
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
      AND (
        pipeline_items.status = 'delivered'
        OR (
          pipeline_items.status = 'skipped'
          AND pipeline_items.skipped_reason = 'no_deliveries'
        )
      )
    ORDER BY source_runs.finished_at ASC, pipeline_items.item_id ASC
  `)

  return {
    async getSummaryCheckpoint(sourceId, effectDomain) {
      const row = getSummaryCheckpointQuery.get(sourceId, effectDomain) as
        | {
            finishedAt: string | null
            startedAt: string
          }
        | undefined

      return row?.finishedAt ?? row?.startedAt
    },

    async getSummaryInputs(sourceIds, window, effectDomain) {
      const result = Object.fromEntries(
        sourceIds.map((sourceId) => [sourceId, toSummarySourceInput(null)]),
      ) as Record<string, SummarySourceInput>

      for (const sourceId of sourceIds) {
        const latestRun = getSummaryLatestRunQuery.get(sourceId, effectDomain) as
          { feedJson: string | null } | undefined

        result[sourceId] = toSummarySourceInput(latestRun?.feedJson ?? null)
      }

      const itemRows = getSummaryItemsQuery.all(
        window.after,
        window.atOrBefore,
        effectDomain,
        effectDomain,
      ) as Array<{
        sourceId: string
        normalizedJson: string
      }>

      for (const row of itemRows) {
        if (!sourceIds.includes(row.sourceId)) continue
        const parsed = parseSummaryJsonRecord(row.normalizedJson)
        if (!parsed) continue
        result[row.sourceId]?.entries.push(parsed)
      }

      return result
    },
  }
}
