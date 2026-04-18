import type { DeliveryAttempt } from '../../domain/delivery_attempt.ts'
import type { PipelineItem } from '../../domain/pipeline_item.ts'
import type { SourceRun } from '../../domain/source_run.ts'

export interface SourceRunView {
  run: SourceRun
  items: PipelineItem[]
  attempts: DeliveryAttempt[]
}

export interface SourceRunQueryService {
  getRun(runId: string): Promise<SourceRunView | undefined>
}
