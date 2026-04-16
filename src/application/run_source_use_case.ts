import type { UnifiedEntryFields } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import { createDeliveryAttempt } from '../domain/delivery_attempt.ts'
import { createPipelineItem } from '../domain/pipeline_item.ts'
import { createRunPlan, type DeliveryBinding, type RunPlan } from '../domain/run_plan.ts'
import { createSourceRun, finalizeSourceRun } from '../domain/source_run.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DeliveryAttemptRepository } from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import type { RunRepository } from './ports/run_repository.ts'
import type { ParsedSourceSnapshot, SourceParser } from './ports/source_parser.ts'
import type { FetchedSourceInput, SourceInputGateway } from './ports/source_input_gateway.ts'
import { DeduplicationStage } from './stages/deduplication_stage.ts'
import { DeliveryStage } from './stages/delivery_stage.ts'
import { FilterStage } from './stages/filter_stage.ts'
import { RenderStage } from './stages/render_stage.ts'

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

export class RunSourceUseCase {
  constructor(private readonly deps: RunSourceUseCaseDeps) {}

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
    return await this.collectPlanned(plan)
  }

  async execute(input: RunSourceRequest): Promise<RunSourceResult> {
    const plan = await this.plan(input)
    const lifecycleCounts = {
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
      if (!pipelineDeps) {
        this.logRunFinalize(plan, 'success', lifecycleCounts)
        return collected
      }

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
    pipelineDeps: {
      runRepository: RunRepository
      itemRepository: ItemRepository
      deliveryAttemptRepository: DeliveryAttemptRepository
      deduplicationRepository: DeduplicationRepository
      deliveryExecutors: Partial<DeliveryExecutorRegistry>
    },
    lifecycleCounts: {
      sourceItemCount: number
      filteredCount: number
      dedupedCount: number
      pushedCount: number
      failedCount: number
    },
  ): Promise<void> {
    const { plan, parsed } = collected
    const run = createSourceRun({
      runId: plan.runId,
      sourceId: plan.source.sourceId,
      trigger: plan.trigger,
      profile: plan.profile,
      effectDomain: plan.effectDomain,
      scheduledAt: plan.scheduledAt,
      startedAt: this.deps.now(),
    })

    try {
      await pipelineDeps.runRepository.insert(run)
      await pipelineDeps.runRepository.setFeedSnapshot?.(run.runId, parsed.feed)

      const items = parsed.items.map((entry) =>
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

      const counts = {
        fetchedCount: parsed.items.length,
        parsedCount: parsed.items.length,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      }
      const bindings = plan.bindings.filter((binding) => binding.sourceId === plan.source.sourceId)
      const filterStage = new FilterStage({
        shouldPassFilter: ({ item, filterTemplate }) => {
          if (!this.deps.shouldPassFilter || filterTemplate === undefined) {
            return Promise.resolve(true)
          }

          return this.deps.shouldPassFilter({
            item: item.normalized,
            feed: parsed.feed,
            source: {
              id: plan.source.sourceId,
              title: parsed.feed.title,
              ...(plan.source.kind === 'summary'
                ? { runtime: { window: { scheduledAt: plan.scheduledAt } } }
                : {}),
            },
            filterTemplate,
          })
        },
      })
      const deduplicationStage = new DeduplicationStage({
        repository: pipelineDeps.deduplicationRepository,
      })
      const renderStage = new RenderStage({
        now: this.deps.now,
        createAttemptId: this.deps.createAttemptId ?? defaultCreateAttemptId,
        renderContent: (template, context) =>
          this.deps.renderContent?.(template, context) ??
          Promise.resolve(renderTemplate(template, context)),
        renderPayload: (payload, context) =>
          this.deps.renderPayload?.(payload, context) ??
          Promise.resolve(renderPayloadTemplate(payload, context)),
      })
      const deliveryDispatchLogger = this.deps.logger?.child({
        module: 'delivery.runtime.dispatch',
      })

      for (const item of items) {
        const filterResult = await filterStage.run({
          item,
          filterTemplate: plan.source.filter ?? undefined,
        })
        if (filterResult.status === 'filtered') {
          counts.filteredCount += 1
          lifecycleCounts.filteredCount += 1
          this.logFilteredItem(plan, item.itemId)
          await pipelineDeps.itemRepository.updateStatus(item.itemId, 'filtered', undefined)
          continue
        }

        const dedupeResult = await deduplicationStage.run({
          fingerprint: item.normalized.id,
          sourceId: item.sourceId,
          effectDomain: item.effectDomain,
          deliveries: bindings.map((binding) => binding.deliveryId),
          recordedAt: this.deps.now(),
        })

        if (dedupeResult.itemStatus === 'duplicate') {
          counts.duplicateItemCount += 1
          await pipelineDeps.itemRepository.updateStatus(item.itemId, 'duplicate', undefined)
          continue
        }

        let delivered = 0
        let failed = 0
        let duplicateDeliveries = 0
        for (const binding of bindings) {
          if (dedupeResult.deliveryStatuses[binding.deliveryId] === 'duplicate') {
            duplicateDeliveries += 1
            lifecycleCounts.dedupedCount += 1
            this.logDedupedDelivery(plan, item.itemId, binding.deliveryId)
            continue
          }

          const attemptPlan = await renderStage.run({
            item,
            binding,
            feed: parsed.feed,
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
          await pipelineDeps.deliveryAttemptRepository.insertPlanned(attempt)

          const executor = pipelineDeps.deliveryExecutors[attempt.channel]
          if (!executor) {
            throw new Error(`缺少 ${attempt.channel} delivery executor`)
          }

          const attemptResult = await new DeliveryStage({
            now: this.deps.now,
            executor,
            logger: deliveryDispatchLogger,
          }).run(attemptPlan)
          await pipelineDeps.deliveryAttemptRepository.finish(attempt.attemptId, attemptResult)

          if (attemptResult.status === 'delivered') {
            await pipelineDeps.deduplicationRepository.registerDeliveryFingerprint({
              sourceId: item.sourceId,
              deliveryId: binding.deliveryId,
              effectDomain: item.effectDomain,
              fingerprint: item.normalized.id,
              recordedAt: this.deps.now(),
            })
            delivered += 1
            counts.deliveredCount += 1
            lifecycleCounts.pushedCount += 1
          } else {
            failed += 1
            counts.failedAttemptCount += 1
            lifecycleCounts.failedCount += 1
          }
        }

        if (failed > 0) {
          await pipelineDeps.itemRepository.updateStatus(item.itemId, 'failed', undefined)
          continue
        }

        if (delivered > 0) {
          await pipelineDeps.deduplicationRepository.registerItemFingerprint({
            sourceId: item.sourceId,
            effectDomain: item.effectDomain,
            fingerprint: item.normalized.id,
            recordedAt: this.deps.now(),
          })
          await pipelineDeps.itemRepository.updateStatus(item.itemId, 'delivered', undefined)
          continue
        }

        if (duplicateDeliveries > 0 || bindings.length === 0) {
          counts.skippedCount += 1
          await pipelineDeps.itemRepository.updateStatus(
            item.itemId,
            'skipped',
            duplicateDeliveries > 0 ? 'all_deliveries_duplicate' : 'no_deliveries',
          )
          continue
        }

        await pipelineDeps.itemRepository.updateStatus(item.itemId, 'ready', undefined)
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

  private getPipelineDeps(): {
    runRepository: RunRepository
    itemRepository: ItemRepository
    deliveryAttemptRepository: DeliveryAttemptRepository
    deduplicationRepository: DeduplicationRepository
    deliveryExecutors: Partial<DeliveryExecutorRegistry>
  } | null {
    if (
      this.deps.runRepository === undefined ||
      this.deps.itemRepository === undefined ||
      this.deps.deliveryAttemptRepository === undefined ||
      this.deps.deduplicationRepository === undefined ||
      this.deps.deliveryExecutors === undefined
    ) {
      return null
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

  private logRunFinalize(
    plan: RunPlan,
    outcome: 'success' | 'failure',
    counts: {
      sourceItemCount: number
      filteredCount: number
      dedupedCount: number
      pushedCount: number
      failedCount: number
    },
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

function defaultCreateAttemptId(input: {
  sourceRunId: string
  itemId: string
  deliveryId: string
}): string {
  return `${input.sourceRunId}:${input.itemId}:${input.deliveryId}`
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const value = lookupTemplateValue(context, expression.trim())
    return value === undefined || value === null ? '' : String(value)
  })
}

function renderPayloadTemplate(payload: unknown, context: Record<string, unknown>): unknown {
  if (typeof payload === 'string') {
    return renderTemplate(payload, context)
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (typeof item === 'string' || Array.isArray(item) || (item && typeof item === 'object')) {
        return renderPayloadTemplate(item, context)
      }
      return item
    })
  }

  if (!payload || typeof payload !== 'object') {
    return payload
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (
        typeof value === 'string' ||
        Array.isArray(value) ||
        (value && typeof value === 'object')
      ) {
        return [key, renderPayloadTemplate(value, context)]
      }
      return [key, value]
    }),
  )
}

function lookupTemplateValue(context: Record<string, unknown>, expression: string): unknown {
  const segments = expression.split('.')
  let current: unknown = context
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
