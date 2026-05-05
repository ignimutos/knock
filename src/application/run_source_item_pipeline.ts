import type { UnifiedFeedFields } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import { createDeliveryAttempt } from '../domain/delivery_attempt.ts'
import type { PipelineItem, PipelineItemSkippedReason } from '../domain/pipeline_item.ts'
import type { DeliveryBinding, RunPlan } from '../domain/run_plan.ts'
import type { DeliveryAttemptRepository } from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import { DeduplicationStage } from './stages/deduplication_stage.ts'
import { DeliveryStage } from './stages/delivery_stage.ts'
import { FilterStage } from './stages/filter_stage.ts'
import { RenderStage } from './stages/render_stage.ts'

export interface RunSourceItemPipelineCounts {
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

export interface RunSourceItemPipelineLifecycleCounts {
  filteredCount: number
  dedupedCount: number
  pushedCount: number
  failedCount: number
}

export interface RunSourceItemPipelineResult {
  counts: RunSourceItemPipelineCounts
  lifecycleCounts: RunSourceItemPipelineLifecycleCounts
}

export interface RunSourceItemPipelineDeps {
  now: () => string
  plan: RunPlan
  feed: UnifiedFeedFields
  bindings: DeliveryBinding[]
  deliveryIds: string[]
  filterStage: FilterStage
  deduplicationStage: DeduplicationStage
  renderStage: RenderStage
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
  logger?: Logger
  deliveryDispatchLogger?: Logger
}

interface DeliveryProcessingResult {
  delivered: number
  failed: number
  duplicateDeliveries: number
  lifecycleCounts: RunSourceItemPipelineLifecycleCounts
}

const EMPTY_COUNTS: RunSourceItemPipelineCounts = {
  filteredCount: 0,
  duplicateItemCount: 0,
  deliveredCount: 0,
  failedAttemptCount: 0,
  skippedCount: 0,
}

const EMPTY_LIFECYCLE_COUNTS: RunSourceItemPipelineLifecycleCounts = {
  filteredCount: 0,
  dedupedCount: 0,
  pushedCount: 0,
  failedCount: 0,
}

export class RunSourceItemPipeline {
  constructor(private readonly deps: RunSourceItemPipelineDeps) {}

  async run(item: PipelineItem): Promise<RunSourceItemPipelineResult> {
    const filterResult = await this.deps.filterStage.run({
      item,
      filterTemplate: this.deps.plan.source.filter ?? undefined,
    })
    if (filterResult.status === 'filtered') {
      this.logFilteredItem(item.itemId)
      await this.deps.itemRepository.updateStatus(item.itemId, 'filtered', undefined)
      return {
        counts: {
          ...EMPTY_COUNTS,
          filteredCount: 1,
        },
        lifecycleCounts: {
          ...EMPTY_LIFECYCLE_COUNTS,
          filteredCount: 1,
        },
      }
    }

    const dedupeResult = await this.deps.deduplicationStage.run({
      fingerprint: item.normalized.id,
      sourceId: item.sourceId,
      effectDomain: item.effectDomain,
      deliveries: this.deps.deliveryIds,
      recordedAt: this.deps.now(),
    })

    if (dedupeResult.itemStatus === 'duplicate') {
      await this.deps.itemRepository.updateStatus(item.itemId, 'duplicate', undefined)
      return {
        counts: {
          ...EMPTY_COUNTS,
          duplicateItemCount: 1,
        },
        lifecycleCounts: { ...EMPTY_LIFECYCLE_COUNTS },
      }
    }

    const deliveryResult = await this.processDeliveries(item, dedupeResult.deliveryStatuses)
    await this.finalizeItemStatus(item, deliveryResult)

    return {
      counts: {
        ...EMPTY_COUNTS,
        deliveredCount: deliveryResult.delivered,
        failedAttemptCount: deliveryResult.failed,
        skippedCount:
          deliveryResult.failed === 0 && deliveryResult.delivered === 0
            ? Number(deliveryResult.duplicateDeliveries > 0 || this.deps.bindings.length === 0)
            : 0,
      },
      lifecycleCounts: deliveryResult.lifecycleCounts,
    }
  }

  private async processDeliveries(
    item: PipelineItem,
    deliveryStatuses: Record<string, 'new' | 'duplicate'>,
  ): Promise<DeliveryProcessingResult> {
    let delivered = 0
    let failed = 0
    let duplicateDeliveries = 0
    const lifecycleCounts = { ...EMPTY_LIFECYCLE_COUNTS }

    for (const binding of this.deps.bindings) {
      if (deliveryStatuses[binding.deliveryId] === 'duplicate') {
        duplicateDeliveries += 1
        lifecycleCounts.dedupedCount += 1
        this.logDedupedDelivery(item.itemId, binding.deliveryId)
        continue
      }

      const attemptPlan = await this.deps.renderStage.run({
        item,
        binding,
        feed: this.deps.feed,
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
      await this.deps.deliveryAttemptRepository.insertPlanned(attempt)

      const executor = this.deps.deliveryExecutors[attempt.channel]
      if (!executor) {
        throw new Error(`缺少 ${attempt.channel} delivery executor`)
      }

      const attemptResult = await new DeliveryStage({
        now: this.deps.now,
        executor,
        logger: this.deps.deliveryDispatchLogger,
      }).run(attemptPlan)
      await this.deps.deliveryAttemptRepository.finish(attempt.attemptId, attemptResult)

      if (attemptResult.status === 'delivered') {
        await this.deps.deduplicationRepository.registerDeliveryFingerprint({
          sourceId: item.sourceId,
          deliveryId: binding.deliveryId,
          effectDomain: item.effectDomain,
          fingerprint: item.normalized.id,
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

  private async finalizeItemStatus(
    item: PipelineItem,
    deliveryResult: DeliveryProcessingResult,
  ): Promise<void> {
    if (deliveryResult.failed > 0) {
      await this.deps.itemRepository.updateStatus(item.itemId, 'failed', undefined)
      return
    }

    if (deliveryResult.delivered > 0) {
      await this.deps.deduplicationRepository.registerItemFingerprint({
        sourceId: item.sourceId,
        effectDomain: item.effectDomain,
        fingerprint: item.normalized.id,
        recordedAt: this.deps.now(),
      })
      await this.deps.itemRepository.updateStatus(item.itemId, 'delivered', undefined)
      return
    }

    if (deliveryResult.duplicateDeliveries > 0 || this.deps.bindings.length === 0) {
      const skippedReason: PipelineItemSkippedReason =
        deliveryResult.duplicateDeliveries > 0 ? 'all_deliveries_duplicate' : 'no_deliveries'
      await this.deps.itemRepository.updateStatus(item.itemId, 'skipped', skippedReason)
      return
    }

    await this.deps.itemRepository.updateStatus(item.itemId, 'ready', undefined)
  }

  private logFilteredItem(itemId: string): void {
    this.deps.logger?.info('pipeline item filtered', {
      module: 'pipeline.filter',
      'pipeline.operation': 'filter',
      'pipeline.outcome': 'filtered',
      'source.id': this.deps.plan.source.sourceId,
      'source.run_id': this.deps.plan.runId,
      'pipeline.item_id': itemId,
    })
  }

  private logDedupedDelivery(itemId: string, deliveryId: string): void {
    this.deps.logger?.info('delivery dedupe hit', {
      module: 'delivery.store',
      'delivery.operation': 'is_delivered',
      'delivery.outcome': 'deduped',
      'source.id': this.deps.plan.source.sourceId,
      'source.run_id': this.deps.plan.runId,
      'pipeline.item_id': itemId,
      'delivery.id': deliveryId,
    })
  }
}
