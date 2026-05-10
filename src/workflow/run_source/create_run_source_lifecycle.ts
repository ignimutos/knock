import { RunSourceLifecycle } from './run_source_lifecycle.ts'
import type { RunSourceExecutionContext } from './run_source_execution_types.ts'

export function createRunSourceLifecycle(context: RunSourceExecutionContext): RunSourceLifecycle {
  return new RunSourceLifecycle({
    now: context.now,
    runRepository: context.runRepository,
    logger: context.logger,
  })
}
