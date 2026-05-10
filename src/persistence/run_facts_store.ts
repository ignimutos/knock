import type { UnifiedFeedFields } from '../config/types.ts'
import type { DeliveryAttempt } from '../domain/delivery_attempt.ts'
import type {
  PipelineItem,
  PipelineItemSkippedReason,
  PipelineItemStatus,
} from '../domain/pipeline_item.ts'
import type { SourceRun } from '../domain/source_run.ts'

export interface FinishAttemptInput {
  status: 'delivered' | 'failed'
  reason?: string
  startedAt: string
  finishedAt: string
}

export interface RunFactsStore {
  insertRun(run: SourceRun): Promise<void>
  updateRun(run: SourceRun): Promise<void>
  setFeedSnapshot(runId: string, feed: UnifiedFeedFields): Promise<void>
  insertItems(items: PipelineItem[]): Promise<void>
  updateItemStatus(
    itemId: string,
    status: PipelineItemStatus,
    skippedReason?: PipelineItemSkippedReason,
  ): Promise<void>
  insertPlannedAttempt(attempt: DeliveryAttempt): Promise<void>
  finishAttempt(attemptId: string, result: FinishAttemptInput): Promise<void>
}
