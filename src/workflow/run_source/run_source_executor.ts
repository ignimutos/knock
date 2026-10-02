import { createRunSourceLifecycle } from './create_run_source_lifecycle.ts'
import {
  createRunSourceLifecycleCounts,
  toRunSourceLifecycleCounts,
} from './run_source_execution_counts.ts'
import { RunSourceExecutionPipeline } from './run_source_execution_pipeline.ts'
import type { CollectedSourceRun, RunSourceExecutionContext } from './run_source_execution_types.ts'

export class RunSourceExecutor {
  async executeCollected(
    collected: CollectedSourceRun,
    context: RunSourceExecutionContext,
  ): Promise<void> {
    const lifecycle = createRunSourceLifecycle(context)
    const lifecycleCounts = createRunSourceLifecycleCounts(collected.parsed.items.length)

    lifecycle.logStart(collected.plan)

    try {
      const result = await new RunSourceExecutionPipeline({
        collected,
        context,
        lifecycle,
      }).run()
      lifecycle.logFinalize(
        collected.plan,
        'success',
        toRunSourceLifecycleCounts(collected.parsed.items.length, result),
      )
    } catch (error) {
      lifecycle.logFinalize(collected.plan, 'failure', lifecycleCounts)
      throw error
    }
  }
}
