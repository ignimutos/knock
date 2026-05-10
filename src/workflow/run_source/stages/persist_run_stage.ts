import { createSourceRun, type SourceRun } from '../../../domain/source_run.ts'
import type {
  CollectedSourceRun,
  RunSourceExecutionContext,
} from '../run_source_execution_types.ts'

export async function persistRunStage(
  collected: CollectedSourceRun,
  context: RunSourceExecutionContext,
): Promise<SourceRun> {
  const run = createSourceRun({
    runId: collected.plan.runId,
    sourceId: collected.plan.source.sourceId,
    trigger: collected.plan.trigger,
    profile: collected.plan.profile,
    effectDomain: collected.plan.effectDomain,
    scheduledAt: collected.plan.scheduledAt,
    startedAt: context.now(),
  })

  await context.runRepository.insert(run)
  await context.runRepository.setFeedSnapshot?.(run.runId, collected.parsed.feed)
  return run
}
