import type {
  PruneFactsInput,
  PruneFactsRepository,
  PruneFactsResult,
} from '../../application/ports/prune_facts_repository.ts'
import { parseDurationMs } from '../../config/runtime_semantics.ts'
import { runInTransaction, type FactsDbClient } from '../../db/client.ts'

interface RunIdRow {
  runId: string
}

function toRunIds(rows: unknown[]): string[] {
  return (rows as RunIdRow[]).map((row) => row.runId)
}

function toChangeCount(value: number | bigint): number {
  return Number(value)
}

function resolveCutoff(input: PruneFactsInput): string {
  return new Date(
    Date.parse(input.now) - parseDurationMs(input.maxAge, 'sqlite.retention.maxAge'),
  ).toISOString()
}

function collectPrunedRunIds(db: FactsDbClient, input: PruneFactsInput, cutoff: string): string[] {
  const agedRunIds = toRunIds(
    db.$client
      .prepare(
        `
        SELECT run_id AS runId
        FROM source_runs
        WHERE finished_at IS NOT NULL
          AND finished_at < ?
      `,
      )
      .all(cutoff),
  )

  const cappedRunIds = toRunIds(
    db.$client
      .prepare(
        `
        WITH ranked AS (
          SELECT
            run_id AS runId,
            ROW_NUMBER() OVER (
              PARTITION BY source_id
              ORDER BY finished_at DESC, started_at DESC
            ) AS row_number
          FROM source_runs
          WHERE finished_at IS NOT NULL
        )
        SELECT runId
        FROM ranked
        WHERE row_number > ?
      `,
      )
      .all(input.maxEntriesPerSource),
  )

  return [...new Set([...agedRunIds, ...cappedRunIds])]
}

function deleteRuns(
  db: FactsDbClient,
  runIds: string[],
): Omit<PruneFactsResult, 'deletedDeduplications'> {
  if (runIds.length === 0) {
    return {
      deletedRuns: 0,
      deletedItems: 0,
      deletedAttempts: 0,
    }
  }

  const deleteAttempts = db.$client.prepare('DELETE FROM delivery_attempts WHERE source_run_id = ?')
  const deleteItems = db.$client.prepare('DELETE FROM pipeline_items WHERE source_run_id = ?')
  const deleteRuns = db.$client.prepare('DELETE FROM source_runs WHERE run_id = ?')

  let deletedAttempts = 0
  let deletedItems = 0
  let deletedRuns = 0

  for (const runId of runIds) {
    deletedAttempts += toChangeCount(deleteAttempts.run(runId).changes)
    deletedItems += toChangeCount(deleteItems.run(runId).changes)
    deletedRuns += toChangeCount(deleteRuns.run(runId).changes)
  }

  return {
    deletedRuns,
    deletedItems,
    deletedAttempts,
  }
}

export function createPruneFactsRepository(db: FactsDbClient): PruneFactsRepository {
  return {
    prune(input: PruneFactsInput): Promise<PruneFactsResult> {
      const cutoff = resolveCutoff(input)

      return Promise.resolve(
        runInTransaction(db, () => {
          const runIds = collectPrunedRunIds(db, input, cutoff)
          const deletedFacts = deleteRuns(db, runIds)
          const deletedDeduplications = toChangeCount(
            db.$client.prepare('DELETE FROM deduplications WHERE recorded_at < ?').run(cutoff)
              .changes,
          )

          return {
            ...deletedFacts,
            deletedDeduplications,
          }
        }),
      )
    },
  }
}
