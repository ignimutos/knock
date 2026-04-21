import type { UnifiedEntryFields } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import { createRunPlan, type DeliveryBinding, type RunPlan } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DeliveryAttemptRepository } from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import type { RunRepository } from './ports/run_repository.ts'
import type { ParsedSourceSnapshot, SourceParser } from './ports/source_parser.ts'
import type { FetchedSourceInput, SourceInputGateway } from './ports/source_input_gateway.ts'
import { RunSourceExecutionPipeline } from './run_source_execution_pipeline.ts'

export interface RunSourceRequest {
  source: SourceDefinition
  profile: 'production' | 'preview'
  effectDomain: 'production' | 'preview'
  trigger: 'scheduled' | 'immediate' | 'manual' | 'preview'
  bindings?: DeliveryBinding[]
  scheduledAt?: string
}

export interface RunSourceResult {
  plan: RunPlan
  fetchedInput: FetchedSourceInput
  parsed: ParsedSourceSnapshot
}

export interface RunSourceUseCaseDeps {
  now: () => string
  createRunId: () => string
  sourceInputGateway: SourceInputGateway
  sourceParser: SourceParser
  createItemId?: (entry: UnifiedEntryFields) => string
  createAttemptId?: (input: { sourceRunId: string; itemId: string; deliveryId: string }) => string
  runRepository?: RunRepository
  itemRepository?: ItemRepository
  deliveryAttemptRepository?: DeliveryAttemptRepository
  deduplicationRepository?: DeduplicationRepository
  deliveryExecutors?: Partial<DeliveryExecutorRegistry>
  renderContent?: (template: string, context: Record<string, unknown>) => Promise<string>
  renderPayload?: (payload: unknown, context: Record<string, unknown>) => Promise<unknown>
  shouldPassFilter?: (input: {
    item: UnifiedEntryFields
    feed: ParsedSourceSnapshot['feed']
    source: { id: string; title: string; runtime?: { window?: { scheduledAt: string } } }
    filterTemplate: string
  }) => Promise<boolean>
  logger?: Logger
}

type PipelineDeps = {
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
}

type LifecycleCounts = {
  sourceItemCount: number
  filteredCount: number
  dedupedCount: number
  pushedCount: number
  failedCount: number
}

class SourceRunExecutor {
  constructor(private readonly deps: RunSourceUseCaseDeps) {}

  async collect(plan: RunPlan): Promise<RunSourceResult> {
    return await this.collectPlanned(plan)
  }

  async execute(plan: RunPlan): Promise<RunSourceResult> {
    const lifecycleCounts: LifecycleCounts = {
      sourceItemCount: 0,
      filteredCount: 0,
      dedupedCount: 0,
      pushedCount: 0,
      failedCount: 0,
    }

    this.logRunStart(plan)

    try {
      const collected = await this.collectPlanned(plan)
      lifecycleCounts.sourceItemCount = collected.parsed.items.length

      const pipelineDeps = this.getPipelineDeps()
      await this.applyCollected(collected, pipelineDeps, lifecycleCounts)
      this.logRunFinalize(plan, 'success', lifecycleCounts)
      return collected
    } catch (error) {
      this.logRunFinalize(plan, 'failure', lifecycleCounts)
      throw error
    }
  }

  private async collectPlanned(plan: RunPlan): Promise<RunSourceResult> {
    const fetchedInput = await this.deps.sourceInputGateway.fetch(plan)
    const parsed = await this.deps.sourceParser.parse(plan, fetchedInput)

    return {
      plan,
      fetchedInput,
      parsed,
    }
  }

  private async applyCollected(
    collected: RunSourceResult,
    pipelineDeps: PipelineDeps,
    lifecycleCounts: LifecycleCounts,
  ): Promise<void> {
    const result = await new RunSourceExecutionPipeline({
      now: this.deps.now,
      plan: collected.plan,
      parsed: collected.parsed,
      createItemId: (entry) => this.createItemId(entry),
      createAttemptId: this.deps.createAttemptId,
      runRepository: pipelineDeps.runRepository,
      itemRepository: pipelineDeps.itemRepository,
      deliveryAttemptRepository: pipelineDeps.deliveryAttemptRepository,
      deduplicationRepository: pipelineDeps.deduplicationRepository,
      deliveryExecutors: pipelineDeps.deliveryExecutors,
      renderContent: this.deps.renderContent,
      renderPayload: this.deps.renderPayload,
      shouldPassFilter: this.deps.shouldPassFilter,
      logger: this.deps.logger,
    }).run()

    lifecycleCounts.filteredCount += result.filteredCount
    lifecycleCounts.dedupedCount += result.dedupedCount
    lifecycleCounts.pushedCount += result.pushedCount
    lifecycleCounts.failedCount += result.failedCount
  }

  private getPipelineDeps(): PipelineDeps {
    if (
      this.deps.runRepository === undefined ||
      this.deps.itemRepository === undefined ||
      this.deps.deliveryAttemptRepository === undefined ||
      this.deps.deduplicationRepository === undefined ||
      this.deps.deliveryExecutors === undefined
    ) {
      throw new Error('run source execute 缺少完整 pipeline 依赖')
    }

    return {
      runRepository: this.deps.runRepository,
      itemRepository: this.deps.itemRepository,
      deliveryAttemptRepository: this.deps.deliveryAttemptRepository,
      deduplicationRepository: this.deps.deduplicationRepository,
      deliveryExecutors: this.deps.deliveryExecutors,
    }
  }

  private createItemId(entry: UnifiedEntryFields): string {
    return this.deps.createItemId?.(entry) ?? `${this.deps.createRunId()}:${entry.id}`
  }

  private logRunStart(plan: RunPlan): void {
    this.deps.logger?.info('source run started', {
      module: 'scheduler.source',
      'scheduler.operation': 'run_source',
      'scheduler.outcome': 'start',
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'scheduler.trigger': plan.trigger,
    })
  }

  private logRunFinalize(
    plan: RunPlan,
    outcome: 'success' | 'failure',
    counts: LifecycleCounts,
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
}

export class RunSourceUseCase {
  private readonly executor: SourceRunExecutor

  constructor(private readonly deps: RunSourceUseCaseDeps) {
    this.executor = new SourceRunExecutor(deps)
  }

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

  async collect(input: RunSourceRequest): Promise<RunSourceResult> {
    const plan = await this.plan(input)
    return await this.executor.collect(plan)
  }

  async execute(input: RunSourceRequest): Promise<RunSourceResult> {
    const plan = await this.plan(input)
    return await this.executor.execute(plan)
  }
}
