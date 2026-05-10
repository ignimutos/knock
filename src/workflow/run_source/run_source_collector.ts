import type { RunPlan } from '../../domain/run_plan.ts'
import type { CollectedSourceRun, RunSourceUseCaseDeps } from './run_source_execution_types.ts'

export class RunSourceCollector {
  constructor(
    private readonly deps: Pick<RunSourceUseCaseDeps, 'sourceInputGateway' | 'sourceParser'>,
  ) {}

  async collect(plan: RunPlan): Promise<CollectedSourceRun> {
    const fetchedInput = await this.deps.sourceInputGateway.fetch(plan)
    const parsed = await this.deps.sourceParser.parse(plan, fetchedInput)

    return {
      plan,
      fetchedInput,
      parsed,
    }
  }
}
