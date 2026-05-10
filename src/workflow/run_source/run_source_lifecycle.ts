import type { Logger } from '../../core/logger.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { SourceRun } from '../../domain/source_run.ts'
import type { RunRepository } from '../../workflow/ports/run_repository.ts'
import type { RunSourceLifecycleCounts } from './run_source_execution_types.ts'

export class RunSourceLifecycle {
  constructor(
    private readonly deps: {
      now: () => string
      runRepository: RunRepository
      logger?: Logger
    },
  ) {}

  logStart(plan: RunPlan): void {
    this.deps.logger?.info('source run started', {
      module: 'scheduler.source',
      'scheduler.operation': 'run_source',
      'scheduler.outcome': 'start',
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'scheduler.trigger': plan.trigger,
    })
  }

  logFinalize(
    plan: RunPlan,
    outcome: 'success' | 'failure',
    counts: RunSourceLifecycleCounts,
  ): void {
    const fields = {
      module: 'scheduler.source',
      'scheduler.operation': 'run_source',
      'scheduler.outcome': outcome,
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'source.item_count': counts.sourceItemCount,
      'pipeline.filtered_count': counts.filteredCount,
      'delivery.deduped_count': counts.dedupedCount,
      'delivery.pushed_count': counts.pushedCount,
      'delivery.failed_count': counts.failedCount,
    }

    if (outcome === 'failure') {
      this.deps.logger?.error('source run finalized', fields)
      return
    }

    this.deps.logger?.info('source run finalized', fields)
  }

  async failRun(run: SourceRun): Promise<void> {
    await this.deps.runRepository.update({
      ...run,
      status: 'failed',
      finishedAt: this.deps.now(),
    })
  }
}
