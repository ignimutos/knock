import type { UnifiedEntryFields } from '../config/types.ts'
import type { Logger } from '../core/logger.ts'
import { createPipelineItem } from '../domain/pipeline_item.ts'
import type { RunPlan } from '../domain/run_plan.ts'
import { createSourceRun, finalizeSourceRun } from '../domain/source_run.ts'
import type { DeliveryAttemptRepository } from './ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from './ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from './ports/delivery_executor.ts'
import type { ItemRepository } from './ports/item_repository.ts'
import type { RunRepository } from './ports/run_repository.ts'
import type { ParsedSourceSnapshot } from './ports/source_parser.ts'
import {
  RunSourceItemPipeline,
  type RunSourceItemPipelineLifecycleCounts,
} from './run_source_item_pipeline.ts'
import { DeduplicationStage } from './stages/deduplication_stage.ts'
import { FilterStage } from './stages/filter_stage.ts'
import { RenderStage } from './stages/render_stage.ts'

interface ApplyCounts {
  fetchedCount: number
  parsedCount: number
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

export interface RunSourceExecutionPipelineDeps {
  now: () => string
  plan: RunPlan
  parsed: ParsedSourceSnapshot
  createItemId: (entry: UnifiedEntryFields) => string
  createAttemptId?: (input: { sourceRunId: string; itemId: string; deliveryId: string }) => string
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
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

const EMPTY_LIFECYCLE_COUNTS: RunSourceItemPipelineLifecycleCounts = {
  filteredCount: 0,
  dedupedCount: 0,
  pushedCount: 0,
  failedCount: 0,
}

export class RunSourceExecutionPipeline {
  constructor(private readonly deps: RunSourceExecutionPipelineDeps) {}

  async run(): Promise<RunSourceItemPipelineLifecycleCounts> {
    const run = createSourceRun({
      runId: this.deps.plan.runId,
      sourceId: this.deps.plan.source.sourceId,
      trigger: this.deps.plan.trigger,
      profile: this.deps.plan.profile,
      effectDomain: this.deps.plan.effectDomain,
      scheduledAt: this.deps.plan.scheduledAt,
      startedAt: this.deps.now(),
    })

    try {
      await this.deps.runRepository.insert(run)
      await this.deps.runRepository.setFeedSnapshot?.(run.runId, this.deps.parsed.feed)

      const items = this.deps.parsed.items.map((entry) =>
        createPipelineItem({
          itemId: this.deps.createItemId(entry),
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
      await this.deps.itemRepository.insertMany(items)

      const counts: ApplyCounts = {
        fetchedCount: this.deps.parsed.items.length,
        parsedCount: this.deps.parsed.items.length,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      }
      const lifecycleCounts = { ...EMPTY_LIFECYCLE_COUNTS }
      const itemPipeline = this.createItemPipeline()

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

      await this.deps.runRepository.update(
        finalizeSourceRun(run, {
          ...counts,
          finishedAt: this.deps.now(),
        }),
      )

      return lifecycleCounts
    } catch (error) {
      await this.deps.runRepository.update({
        ...run,
        status: 'failed',
        finishedAt: this.deps.now(),
      })
      throw error
    }
  }

  private createItemPipeline(): RunSourceItemPipeline {
    const bindings = this.deps.plan.bindings.filter(
      (binding) => binding.sourceId === this.deps.plan.source.sourceId,
    )
    const deliveryIds = bindings.map((binding) => binding.deliveryId)
    const deliveryDispatchLogger = this.deps.logger?.child({
      module: 'delivery.runtime.dispatch',
    })

    return new RunSourceItemPipeline({
      now: this.deps.now,
      plan: this.deps.plan,
      feed: this.deps.parsed.feed,
      bindings,
      deliveryIds,
      filterStage: new FilterStage({
        shouldPassFilter: ({ item, filterTemplate }) => {
          if (!this.deps.shouldPassFilter || filterTemplate === undefined) {
            return Promise.resolve(true)
          }

          return this.deps.shouldPassFilter({
            item: item.normalized,
            feed: this.deps.parsed.feed,
            source: {
              id: this.deps.plan.source.sourceId,
              title: this.deps.parsed.feed.title,
              ...(this.deps.plan.source.kind === 'summary'
                ? { runtime: { window: { scheduledAt: this.deps.plan.scheduledAt } } }
                : {}),
            },
            filterTemplate,
          })
        },
      }),
      deduplicationStage: new DeduplicationStage({
        repository: this.deps.deduplicationRepository,
      }),
      renderStage: new RenderStage({
        now: this.deps.now,
        createAttemptId: this.deps.createAttemptId ?? defaultCreateAttemptId,
        renderContent: (template, context) =>
          this.deps.renderContent?.(template, context) ??
          Promise.resolve(renderTemplate(template, context)),
        renderPayload: (payload, context) =>
          this.deps.renderPayload?.(payload, context) ??
          Promise.resolve(renderPayloadTemplate(payload, context)),
      }),
      itemRepository: this.deps.itemRepository,
      deliveryAttemptRepository: this.deps.deliveryAttemptRepository,
      deduplicationRepository: this.deps.deduplicationRepository,
      deliveryExecutors: this.deps.deliveryExecutors,
      logger: this.deps.logger,
      deliveryDispatchLogger,
    })
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
