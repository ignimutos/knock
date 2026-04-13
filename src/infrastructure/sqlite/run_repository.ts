import { eq } from 'drizzle-orm'
import type { UnifiedFeedFields } from '../../config/types.ts'
import type { RunRepository as ApplicationRunRepository } from '../../application/ports/run_repository.ts'
import type { SourceRun } from '../../domain/source_run.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { sourceRuns } from './schema.ts'

export function insertSourceRun(db: FactsDbClient, run: SourceRun): Promise<void> {
  db.insert(sourceRuns)
    .values({
      runId: run.runId,
      sourceId: run.sourceId,
      trigger: run.trigger,
      profile: run.profile,
      effectDomain: run.effectDomain,
      status: run.status,
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      countsJson: JSON.stringify(run.counts),
      feedJson: null,
    })
    .run()

  return Promise.resolve()
}

export function updateSourceRun(db: FactsDbClient, run: SourceRun): Promise<void> {
  db.update(sourceRuns)
    .set({
      sourceId: run.sourceId,
      trigger: run.trigger,
      profile: run.profile,
      effectDomain: run.effectDomain,
      status: run.status,
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      countsJson: JSON.stringify(run.counts),
    })
    .where(eq(sourceRuns.runId, run.runId))
    .run()

  return Promise.resolve()
}

export function setSourceRunFeedSnapshot(
  db: FactsDbClient,
  runId: string,
  feed: UnifiedFeedFields,
): Promise<void> {
  db.update(sourceRuns)
    .set({
      feedJson: JSON.stringify(feed),
    })
    .where(eq(sourceRuns.runId, runId))
    .run()

  return Promise.resolve()
}

export function createRunRepository(db: FactsDbClient): ApplicationRunRepository {
  return {
    insert: (run) => insertSourceRun(db, run),
    update: (run) => updateSourceRun(db, run),
    setFeedSnapshot: (runId, feed) => setSourceRunFeedSnapshot(db, runId, feed),
  }
}
