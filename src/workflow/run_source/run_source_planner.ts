import { createRunPlan, type RunPlan } from '../../domain/run_plan.ts'
import type { RunSourceRequest } from './run_source_contract.ts'
import type { RunSourceUseCaseDeps } from './run_source_execution_types.ts'

export class RunSourcePlanner {
  constructor(private readonly deps: Pick<RunSourceUseCaseDeps, 'now' | 'createRunId'>) {}

  plan(input: RunSourceRequest): Promise<RunPlan> {
    return Promise.resolve(
      createRunPlan({
        runId: this.deps.createRunId(),
        source: input.source,
        profile: input.profile,
        effectDomain: input.effectDomain,
        trigger: input.trigger,
        scheduledAt: input.scheduledAt ?? this.deps.now(),
        bindings: input.bindings ?? [],
      }),
    )
  }
}
