import type { UnifiedEntryFields } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import { createPipelineItem } from '../domain/pipeline_item.ts'
import { createRunPlan, type DeliveryBinding, type RunPlan } from '../domain/run_plan.ts'
import { createSourceRun, finalizeSourceRun } from '../domain/source_run.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DeliveryAttemptRepository } from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import type { RunRepository } from './ports/run_repository.ts'
import { RunSourceItemPipeline } from './run_source_item_pipeline.ts'
import type { ParsedSourceSnapshot, SourceParser } from './ports/source_parser.ts'
import type { FetchedSourceInput, SourceInputGateway } from './ports/source_input_gateway.ts'
import { DeduplicationStage } from './stages/deduplication_stage.ts'
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

      const counts: ApplyCounts = {
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
      const itemPipeline = new RunSourceItemPipeline({
        now: this.deps.now,
        plan,
        feed: parsed.feed,
        bindings,
        filterStage,
        deduplicationStage,
        renderStage,
        itemRepository: pipelineDeps.itemRepository,
        deliveryAttemptRepository: pipelineDeps.deliveryAttemptRepository,
        deduplicationRepository: pipelineDeps.deduplicationRepository,
        deliveryExecutors: pipelineDeps.deliveryExecutors,
        logger: this.deps.logger,
        deliveryDispatchLogger,
      })

      for (const item of items) {
        const result = await itemPipeline.run(item)
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
