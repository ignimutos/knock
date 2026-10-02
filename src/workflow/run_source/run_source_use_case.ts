import type { RunPlan } from '../../domain/run_plan.ts'
import { RunSourceCollector } from './run_source_collector.ts'
import type { RunSourceRequest, RunSourceResult } from './run_source_contract.ts'
import { RunSourceExecutionContextFactory } from './run_source_execution_context_factory.ts'
import { RunSourceExecutor } from './run_source_executor.ts'
import type {
  CollectedSourceRun,
  RunSourceExecutionContext,
  RunSourceLifecycleCounts,
  RunSourceUseCaseDeps,
} from './run_source_execution_types.ts'
import { RunSourcePlanner } from './run_source_planner.ts'

export type { RunSourceRequest, RunSourceResult } from './run_source_contract.ts'
export type {
  CollectedSourceRun,
  RunSourceExecutionContext,
  RunSourceLifecycleCounts,
  RunSourceUseCaseDeps,
} from './run_source_execution_types.ts'

export class RunSourceUseCase {
  private readonly planner: RunSourcePlanner
  private readonly collector: RunSourceCollector
  private readonly contextFactory: RunSourceExecutionContextFactory
  private readonly executor: RunSourceExecutor

  constructor(deps: RunSourceUseCaseDeps) {
    this.planner = new RunSourcePlanner(deps)
    this.collector = new RunSourceCollector(deps)
    this.contextFactory = new RunSourceExecutionContextFactory(deps)
    this.executor = new RunSourceExecutor()
  }

  plan(input: RunSourceRequest): Promise<RunPlan> {
    return this.planner.plan(input)
  }

  async collect(input: RunSourceRequest): Promise<RunSourceResult> {
    const plan = await this.plan(input)
    return await this.collector.collect(plan)
  }

  async execute(input: RunSourceRequest): Promise<RunSourceResult> {
    const collected = await this.collect(input)
    await this.executor.executeCollected(collected, this.contextFactory.create())
    return collected
  }
}
