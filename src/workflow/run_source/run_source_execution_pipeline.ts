import type { SourceRun } from '../../domain/source_run.ts'
import type { RunSourceItemPipelineLifecycleCounts } from '../run_source_item_pipeline.ts'
import {
  createRunSourceExecutionCounts,
  accumulateRunSourceExecutionCounts,
} from './run_source_execution_counts.ts'
import { createRunSourceItemPipeline } from './create_run_source_item_pipeline.ts'
import { RunSourceLifecycle } from './run_source_lifecycle.ts'
import type { CollectedSourceRun, RunSourceExecutionContext } from './run_source_execution_types.ts'
import { finalizeRunStage } from '../stages/finalize_run_stage.ts'
import { materializeItemsStage } from '../stages/materialize_items_stage.ts'
import { persistRunStage } from '../stages/persist_run_stage.ts'

export class RunSourceExecutionPipeline {
  constructor(
    private readonly deps: {
      collected: CollectedSourceRun
      context: RunSourceExecutionContext
      lifecycle: RunSourceLifecycle
    },
  ) {}

  async run(): Promise<RunSourceItemPipelineLifecycleCounts> {
    const aggregate = createRunSourceExecutionCounts(this.deps.collected.parsed.items.length)
    let run: SourceRun | undefined

    try {
      run = await persistRunStage(this.deps.collected, this.deps.context)
      const items = await materializeItemsStage(run, this.deps.collected, this.deps.context)
      const itemPipeline = createRunSourceItemPipeline(this.deps.collected, this.deps.context)

      for (const item of items) {
        const result = await itemPipeline.run(item)
        accumulateRunSourceExecutionCounts(aggregate, result)
      }

      await finalizeRunStage(run, aggregate.runCounts, this.deps.context)
      return aggregate.lifecycleCounts
    } catch (error) {
      if (run) {
        await this.deps.lifecycle.failRun(run)
      }
      throw error
    }
  }
}
