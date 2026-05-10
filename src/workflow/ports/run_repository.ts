import type { UnifiedFeedFields } from '../../config/types.ts'
import type { SourceRun } from '../../domain/source_run.ts'

export interface RunRepository {
  insert(run: SourceRun): Promise<void>
  update(run: SourceRun): Promise<void>
  setFeedSnapshot?(runId: string, feed: UnifiedFeedFields): Promise<void>
}
