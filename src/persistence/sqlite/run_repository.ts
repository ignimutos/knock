import type { UnifiedFeedFields } from '../../config/types.ts'
import type { RunRepository as ApplicationRunRepository } from '../../workflow/ports/run_repository.ts'
import type { SourceRun } from '../../domain/source_run.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'

export function insertSourceRun(db: FactsDbClient, run: SourceRun): Promise<void> {
  db.$client
    .prepare(
      `
        INSERT INTO source_runs (
          run_id,
          source_id,
          trigger,
          profile,
          effect_domain,
          status,
          scheduled_at,
          started_at,
          finished_at,
          counts_json,
          feed_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      run.runId,
      run.sourceId,
      run.trigger,
      run.profile,
      run.effectDomain,
      run.status,
      run.scheduledAt,
      run.startedAt,
      run.finishedAt ?? null,
      JSON.stringify(run.counts),
      null,
    )

  return Promise.resolve()
}

export function updateSourceRun(db: FactsDbClient, run: SourceRun): Promise<void> {
  db.$client
    .prepare(
      `
        UPDATE source_runs
        SET source_id = ?,
            trigger = ?,
            profile = ?,
            effect_domain = ?,
            status = ?,
            scheduled_at = ?,
            started_at = ?,
            finished_at = ?,
            counts_json = ?
        WHERE run_id = ?
      `,
    )
    .run(
      run.sourceId,
      run.trigger,
      run.profile,
      run.effectDomain,
      run.status,
      run.scheduledAt,
      run.startedAt,
      run.finishedAt ?? null,
      JSON.stringify(run.counts),
      run.runId,
    )

  return Promise.resolve()
}

export function setSourceRunFeedSnapshot(
  db: FactsDbClient,
  runId: string,
  feed: UnifiedFeedFields,
): Promise<void> {
  db.$client
    .prepare(
      `
        UPDATE source_runs
        SET feed_json = ?
        WHERE run_id = ?
      `,
    )
    .run(JSON.stringify(feed), runId)

  return Promise.resolve()
}

export function createRunRepository(db: FactsDbClient): ApplicationRunRepository {
  return {
    insert: (run) => insertSourceRun(db, run),
    update: (run) => updateSourceRun(db, run),
    setFeedSnapshot: (runId, feed) => setSourceRunFeedSnapshot(db, runId, feed),
  }
}
