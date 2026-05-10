import {
  finalizeSourceRun,
  type SourceRunCounts,
  type SourceRun,
} from '../../../domain/source_run.ts'
import type { RunSourceExecutionContext } from '../run_source_execution_types.ts'

export async function finalizeRunStage(
  run: SourceRun,
  counts: SourceRunCounts,
  context: RunSourceExecutionContext,
): Promise<void> {
  await context.runRepository.update(
    finalizeSourceRun(run, {
      ...counts,
      finishedAt: context.now(),
    }),
  )
}
