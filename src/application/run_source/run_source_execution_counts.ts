import type { SourceRunCounts } from '../../domain/source_run.ts'
import type {
  RunSourceItemPipelineLifecycleCounts,
  RunSourceItemPipelineResult,
} from '../run_source_item_pipeline.ts'
import type { RunSourceLifecycleCounts } from './run_source_execution_types.ts'

const EMPTY_ITEM_LIFECYCLE_COUNTS: RunSourceItemPipelineLifecycleCounts = {
  filteredCount: 0,
  dedupedCount: 0,
  pushedCount: 0,
  failedCount: 0,
}

export interface RunSourceExecutionCounts {
  runCounts: SourceRunCounts
  lifecycleCounts: RunSourceItemPipelineLifecycleCounts
}

export function createRunSourceExecutionCounts(itemCount: number): RunSourceExecutionCounts {
  return {
    runCounts: {
      fetchedCount: itemCount,
      parsedCount: itemCount,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 0,
    },
    lifecycleCounts: { ...EMPTY_ITEM_LIFECYCLE_COUNTS },
  }
}

export function accumulateRunSourceExecutionCounts(
  aggregate: RunSourceExecutionCounts,
  itemResult: RunSourceItemPipelineResult,
): void {
  aggregate.runCounts.filteredCount += itemResult.counts.filteredCount
  aggregate.runCounts.duplicateItemCount += itemResult.counts.duplicateItemCount
  aggregate.runCounts.deliveredCount += itemResult.counts.deliveredCount
  aggregate.runCounts.failedAttemptCount += itemResult.counts.failedAttemptCount
  aggregate.runCounts.skippedCount += itemResult.counts.skippedCount

  aggregate.lifecycleCounts.filteredCount += itemResult.lifecycleCounts.filteredCount
  aggregate.lifecycleCounts.dedupedCount += itemResult.lifecycleCounts.dedupedCount
  aggregate.lifecycleCounts.pushedCount += itemResult.lifecycleCounts.pushedCount
  aggregate.lifecycleCounts.failedCount += itemResult.lifecycleCounts.failedCount
}

export function createRunSourceLifecycleCounts(sourceItemCount: number): RunSourceLifecycleCounts {
  return {
    sourceItemCount,
    filteredCount: 0,
    dedupedCount: 0,
    pushedCount: 0,
    failedCount: 0,
  }
}

export function toRunSourceLifecycleCounts(
  sourceItemCount: number,
  lifecycleCounts: RunSourceItemPipelineLifecycleCounts,
): RunSourceLifecycleCounts {
  return {
    sourceItemCount,
    filteredCount: lifecycleCounts.filteredCount,
    dedupedCount: lifecycleCounts.dedupedCount,
    pushedCount: lifecycleCounts.pushedCount,
    failedCount: lifecycleCounts.failedCount,
  }
}
