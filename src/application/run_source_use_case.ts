import type { UnifiedEntryFields } from '../config/types.ts'
import {
  type ContentContext,
  renderContent as renderContentFallback,
  renderPayload as renderPayloadFallback,
} from '../core/content_runtime.ts'
import type { Logger } from '../core/logger.ts'
import { createDeliveryAttempt } from '../domain/delivery_attempt.ts'
import {
  createPipelineItem,
  type PipelineItem,
  type PipelineItemSkippedReason,
} from '../domain/pipeline_item.ts'
import { createRunPlan, type DeliveryBinding, type RunPlan } from '../domain/run_plan.ts'
import { createSourceRun, finalizeSourceRun } from '../domain/source_run.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import { createDeliveryAttemptContext, planDeliveryAttempt } from './plan_delivery_attempt.ts'
import type {
  DeliveryAttemptRepository,
  FinishDeliveryAttemptInput,
} from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutor, DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import type { RunRepository } from './ports/run_repository.ts'
import type { ParsedSourceSnapshot, SourceParser } from './ports/source_parser.ts'
import type { FetchedSourceInput, SourceInputGateway } from './ports/source_input_gateway.ts'

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

type ApplyCounts = {
  fetchedCount: number
  parsedCount: number
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

type ItemCounts = {
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

type ItemProcessResult = {
  counts: ItemCounts
  lifecycleCounts: Pick<
    LifecycleCounts,
    'filteredCount' | 'dedupedCount' | 'pushedCount' | 'failedCount'
  >
}

type DeliveryProcessResult = {
  delivered: number
  failed: number
  duplicateDeliveries: number
  lifecycleCounts: Pick<
    LifecycleCounts,
    'filteredCount' | 'dedupedCount' | 'pushedCount' | 'failedCount'
  >
}

const EMPTY_ITEM_COUNTS: ItemCounts = {
  filteredCount: 0,
  duplicateItemCount: 0,
  deliveredCount: 0,
  failedAttemptCount: 0,
  skippedCount: 0,
}

const EMPTY_LIFECYCLE_COUNTS: Pick<
  LifecycleCounts,
  'filteredCount' | 'dedupedCount' | 'pushedCount' | 'failedCount'
> = {
  filteredCount: 0,
  dedupedCount: 0,
  pushedCount: 0,
  failedCount: 0,
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
    const run = createSourceRun({
      runId: collected.plan.runId,
      sourceId: collected.plan.source.sourceId,
      trigger: collected.plan.trigger,
      profile: collected.plan.profile,
      effectDomain: collected.plan.effectDomain,
      scheduledAt: collected.plan.scheduledAt,
      startedAt: this.deps.now(),
    })

    try {
      await pipelineDeps.runRepository.insert(run)
      await pipelineDeps.runRepository.setFeedSnapshot?.(run.runId, collected.parsed.feed)

      const items = collected.parsed.items.map((entry) =>
        createPipelineItem({
          itemId: this.createItemId(entry),
          sourceRunId: run.runId,
          sourceId: run.sourceId,
          effectDomain: run.effectDomain,
          normalized: {
            id: entry.id,
            title: entry.title,
            link: entry.link,
            description: entry.description,
            content: entry.content,
            published: entry.published,
            updated: entry.updated,
          },
        }),
      )
      await pipelineDeps.itemRepository.insertMany(items)

      const counts: ApplyCounts = {
        fetchedCount: collected.parsed.items.length,
        parsedCount: collected.parsed.items.length,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      }
      const bindings = collected.plan.bindings.filter(
        (binding) => binding.sourceId === collected.plan.source.sourceId,
      )
      const deliveryIds = bindings.map((binding) => binding.deliveryId)
      const deliveryDispatchLogger = this.deps.logger?.child({
        module: 'delivery.runtime.dispatch',
      })

      for (const item of items) {
        const result = await this.processItem({
          item,
          plan: collected.plan,
          feed: collected.parsed.feed,
          bindings,
          deliveryIds,
          pipelineDeps,
          deliveryDispatchLogger,
        })
        counts.filteredCount += result.counts.filteredCount
        counts.duplicateItemCount += result.counts.duplicateItemCount
        counts.deliveredCount += result.counts.deliveredCount
        counts.failedAttemptCount += result.counts.failedAttemptCount
        counts.skippedCount += result.counts.skippedCount
        lifecycleCounts.filteredCount += result.lifecycleCounts.filteredCount
        lifecycleCounts.dedupedCount += result.lifecycleCounts.dedupedCount
        lifecycleCounts.pushedCount += result.lifecycleCounts.pushedCount
        lifecycleCounts.failedCount += result.lifecycleCounts.failedCount
      }

      await pipelineDeps.runRepository.update(
        finalizeSourceRun(run, {
          ...counts,
          finishedAt: this.deps.now(),
        }),
      )
    } catch (error) {
      await pipelineDeps.runRepository.update({
        ...run,
        status: 'failed',
        finishedAt: this.deps.now(),
      })
      throw error
    }
  }

  private async processItem(input: {
    item: PipelineItem
    plan: RunPlan
    feed: ParsedSourceSnapshot['feed']
    bindings: DeliveryBinding[]
    deliveryIds: string[]
    pipelineDeps: PipelineDeps
    deliveryDispatchLogger?: Logger
  }): Promise<ItemProcessResult> {
    const filterResult = await this.shouldPassFilter(input.item, input.plan, input.feed)
    if (!filterResult) {
      this.logFilteredItem(input.plan, input.item.itemId)
      await input.pipelineDeps.itemRepository.updateStatus(input.item.itemId, 'filtered', undefined)
      return {
        counts: {
          ...EMPTY_ITEM_COUNTS,
          filteredCount: 1,
        },
        lifecycleCounts: {
          ...EMPTY_LIFECYCLE_COUNTS,
          filteredCount: 1,
        },
      }
    }

    const itemDuplicate = await input.pipelineDeps.deduplicationRepository.isItemDuplicate({
      sourceId: input.item.sourceId,
      effectDomain: input.item.effectDomain,
      fingerprint: input.item.normalized.id,
    })
    if (itemDuplicate) {
      await input.pipelineDeps.itemRepository.updateStatus(
        input.item.itemId,
        'duplicate',
        undefined,
      )
      return {
        counts: {
          ...EMPTY_ITEM_COUNTS,
          duplicateItemCount: 1,
        },
        lifecycleCounts: {
          ...EMPTY_LIFECYCLE_COUNTS,
        },
      }
    }

    const deliveryStatuses = await this.getDeliveryStatuses({
      sourceId: input.item.sourceId,
      effectDomain: input.item.effectDomain,
      fingerprint: input.item.normalized.id,
      deliveryIds: input.deliveryIds,
      repository: input.pipelineDeps.deduplicationRepository,
    })
    const deliveryContext = createDeliveryAttemptContext({
      item: input.item,
      feed: input.feed,
    })
    const deliveryResult = await this.processDeliveries({
      item: input.item,
      plan: input.plan,
      bindings: input.bindings,
      deliveryStatuses,
      pipelineDeps: input.pipelineDeps,
      deliveryContext,
      deliveryDispatchLogger: input.deliveryDispatchLogger,
    })
    await this.finalizeItemStatus(input.item, input.bindings, deliveryResult, input.pipelineDeps)

    return {
      counts: {
        ...EMPTY_ITEM_COUNTS,
        deliveredCount: deliveryResult.delivered,
        failedAttemptCount: deliveryResult.failed,
        skippedCount:
          deliveryResult.failed === 0 && deliveryResult.delivered === 0
            ? Number(deliveryResult.duplicateDeliveries > 0 || input.bindings.length === 0)
            : 0,
      },
      lifecycleCounts: deliveryResult.lifecycleCounts,
    }
  }

  private async shouldPassFilter(
    item: PipelineItem,
    plan: RunPlan,
    feed: ParsedSourceSnapshot['feed'],
  ): Promise<boolean> {
    const filterTemplate = plan.source.filter ?? undefined
    if (!this.deps.shouldPassFilter || !filterTemplate || filterTemplate.trim() === '') {
      return true
    }

    return await this.deps.shouldPassFilter({
      item: item.normalized,
      feed,
      source: {
        id: plan.source.sourceId,
        title: feed.title,
        ...(plan.source.kind === 'summary'
          ? { runtime: { window: { scheduledAt: plan.scheduledAt } } }
          : {}),
      },
      filterTemplate,
    })
  }

  private async getDeliveryStatuses(input: {
    sourceId: string
    effectDomain: 'production' | 'preview'
    fingerprint: string
    deliveryIds: string[]
    repository: DeduplicationRepository
  }): Promise<Record<string, 'new' | 'duplicate'>> {
    return Object.fromEntries(
      await Promise.all(
        input.deliveryIds.map(async (deliveryId) => {
          const duplicate = await input.repository.isDeliveryDuplicate({
            sourceId: input.sourceId,
            deliveryId,
            effectDomain: input.effectDomain,
            fingerprint: input.fingerprint,
          })
          return [deliveryId, duplicate ? 'duplicate' : 'new'] as const
        }),
      ),
    )
  }

  private async processDeliveries(input: {
    item: PipelineItem
    plan: RunPlan
    bindings: DeliveryBinding[]
    deliveryStatuses: Record<string, 'new' | 'duplicate'>
    pipelineDeps: PipelineDeps
    deliveryContext: ContentContext
    deliveryDispatchLogger?: Logger
  }): Promise<DeliveryProcessResult> {
    let delivered = 0
    let failed = 0
    let duplicateDeliveries = 0
    const lifecycleCounts = { ...EMPTY_LIFECYCLE_COUNTS }

    for (const binding of input.bindings) {
      if (input.deliveryStatuses[binding.deliveryId] === 'duplicate') {
        duplicateDeliveries += 1
        lifecycleCounts.dedupedCount += 1
        this.logDedupedDelivery(input.plan, input.item.itemId, binding.deliveryId)
        continue
      }

      const attemptPlan = await planDeliveryAttempt({
        now: this.deps.now,
        createAttemptId: this.deps.createAttemptId ?? defaultCreateAttemptId,
        item: input.item,
        binding,
        context: input.deliveryContext,
        renderContent: (template, context) => this.renderContent(template, context),
        renderPayload: (payload, context) => this.renderPayload(payload, context),
      })
      const attempt = createDeliveryAttempt({
        attemptId: attemptPlan.attemptId,
        itemId: attemptPlan.itemId,
        sourceRunId: attemptPlan.sourceRunId,
        deliveryId: attemptPlan.deliveryId,
        channel: attemptPlan.channel,
        effectDomain: attemptPlan.effectDomain,
        plannedAt: attemptPlan.plannedAt,
        renderedSnapshot: attemptPlan.renderedSnapshot,
      })
      await input.pipelineDeps.deliveryAttemptRepository.insertPlanned(attempt)

      const executor = input.pipelineDeps.deliveryExecutors[attempt.channel]
      if (!executor) {
        throw new Error(`缺少 ${attempt.channel} delivery executor`)
      }

      const attemptResult = await this.executeDeliveryAttempt(
        attemptPlan,
        executor,
        input.deliveryDispatchLogger,
      )
      await input.pipelineDeps.deliveryAttemptRepository.finish(attempt.attemptId, attemptResult)

      if (attemptResult.status === 'delivered') {
        await input.pipelineDeps.deduplicationRepository.registerDeliveryFingerprint({
          sourceId: input.item.sourceId,
          deliveryId: binding.deliveryId,
          effectDomain: input.item.effectDomain,
          fingerprint: input.item.normalized.id,
          recordedAt: this.deps.now(),
        })
        delivered += 1
        lifecycleCounts.pushedCount += 1
        continue
      }

      failed += 1
      lifecycleCounts.failedCount += 1
    }

    return {
      delivered,
      failed,
      duplicateDeliveries,
      lifecycleCounts,
    }
  }

  private async executeDeliveryAttempt(
    plan: Parameters<DeliveryExecutor['execute']>[0],
    executor: DeliveryExecutor,
    logger?: Logger,
  ): Promise<FinishDeliveryAttemptInput> {
    const startedAt = this.deps.now()
    try {
      await executor.execute(plan)
      logger?.info('delivery dispatch success', {
        module: 'delivery.runtime.dispatch',
        'delivery.operation': 'dispatch',
        'delivery.outcome': 'success',
        'delivery.id': plan.deliveryId,
        'pipeline.item_id': plan.itemId,
      })
      return {
        status: 'delivered',
        startedAt,
        finishedAt: this.deps.now(),
      }
    } catch (error) {
      logger?.error('delivery dispatch failed', {
        module: 'delivery.runtime.dispatch',
        'delivery.operation': 'dispatch',
        'delivery.outcome': 'failure',
        'delivery.id': plan.deliveryId,
        'pipeline.item_id': plan.itemId,
        error_name: 'DeliveryDispatchError',
        error_message: 'delivery dispatch failed',
      })
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: this.deps.now(),
      }
    }
  }

  private async finalizeItemStatus(
    item: PipelineItem,
    bindings: DeliveryBinding[],
    deliveryResult: DeliveryProcessResult,
    pipelineDeps: PipelineDeps,
  ): Promise<void> {
    if (deliveryResult.failed > 0) {
      await pipelineDeps.itemRepository.updateStatus(item.itemId, 'failed', undefined)
      return
    }

    if (deliveryResult.delivered > 0) {
      await pipelineDeps.deduplicationRepository.registerItemFingerprint({
        sourceId: item.sourceId,
        effectDomain: item.effectDomain,
        fingerprint: item.normalized.id,
        recordedAt: this.deps.now(),
      })
      await pipelineDeps.itemRepository.updateStatus(item.itemId, 'delivered', undefined)
      return
    }

    if (deliveryResult.duplicateDeliveries > 0 || bindings.length === 0) {
      const skippedReason: PipelineItemSkippedReason =
        deliveryResult.duplicateDeliveries > 0 ? 'all_deliveries_duplicate' : 'no_deliveries'
      await pipelineDeps.itemRepository.updateStatus(item.itemId, 'skipped', skippedReason)
      return
    }

    await pipelineDeps.itemRepository.updateStatus(item.itemId, 'ready', undefined)
  }

  private renderContent(template: string, context: Record<string, unknown>): Promise<string> {
    return this.deps.renderContent?.(template, context) ?? renderContentFallback(template, context)
  }

  private renderPayload(payload: unknown, context: Record<string, unknown>): Promise<unknown> {
    return (
      this.deps.renderPayload?.(payload, context) ??
      renderPayloadFallback(payload as never, context)
    )
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
    this.deps.logger?.trace('source run trace context', {
      module: 'scheduler.source',
      'scheduler.operation': 'run_source',
      'scheduler.outcome': 'start',
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'scheduler.trigger': plan.trigger,
      'scheduler.profile': plan.profile,
      'scheduler.effect_domain': plan.effectDomain,
      'scheduler.binding_count': plan.bindings.length,
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

  private logFilteredItem(plan: RunPlan, itemId: string): void {
    this.deps.logger?.info('pipeline item filtered', {
      module: 'pipeline.filter',
      'pipeline.operation': 'filter',
      'pipeline.outcome': 'filtered',
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'pipeline.item_id': itemId,
    })
  }

  private logDedupedDelivery(plan: RunPlan, itemId: string, deliveryId: string): void {
    this.deps.logger?.info('delivery dedupe hit', {
      module: 'delivery.store',
      'delivery.operation': 'is_delivered',
      'delivery.outcome': 'deduped',
      'source.id': plan.source.sourceId,
      'source.run_id': plan.runId,
      'pipeline.item_id': itemId,
      'delivery.id': deliveryId,
    })
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

function defaultCreateAttemptId(input: {
  sourceRunId: string
  itemId: string
  deliveryId: string
}): string {
  return `${input.sourceRunId}:${input.itemId}:${input.deliveryId}`
}
