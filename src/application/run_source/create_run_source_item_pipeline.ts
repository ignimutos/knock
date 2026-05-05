import { RunSourceItemPipeline } from '../run_source_item_pipeline.ts'
import { DeduplicationStage } from '../stages/deduplication_stage.ts'
import { FilterStage } from '../stages/filter_stage.ts'
import { RenderStage } from '../stages/render_stage.ts'
import type { CollectedSourceRun, RunSourceExecutionContext } from './run_source_execution_types.ts'

export function createRunSourceItemPipeline(
  collected: CollectedSourceRun,
  context: RunSourceExecutionContext,
): RunSourceItemPipeline {
  const bindings = collected.plan.bindings.filter(
    (binding) => binding.sourceId === collected.plan.source.sourceId,
  )
  const deliveryIds = bindings.map((binding) => binding.deliveryId)
  const deliveryDispatchLogger = context.logger?.child({
    module: 'delivery.runtime.dispatch',
  })

  return new RunSourceItemPipeline({
    now: context.now,
    plan: collected.plan,
    feed: collected.parsed.feed,
    bindings,
    deliveryIds,
    filterStage: new FilterStage({
      shouldPassFilter: ({ item, filterTemplate }) => {
        if (!context.shouldPassFilter || filterTemplate === undefined) {
          return Promise.resolve(true)
        }

        return context.shouldPassFilter({
          item: item.normalized,
          feed: collected.parsed.feed,
          source: {
            id: collected.plan.source.sourceId,
            title: collected.parsed.feed.title,
            ...(collected.plan.source.kind === 'summary'
              ? { runtime: { window: { scheduledAt: collected.plan.scheduledAt } } }
              : {}),
          },
          filterTemplate,
        })
      },
    }),
    deduplicationStage: new DeduplicationStage({
      repository: context.deduplicationRepository,
    }),
    renderStage: new RenderStage({
      now: context.now,
      createAttemptId: context.createAttemptId,
      renderContent: context.renderContent,
      renderPayload: context.renderPayload,
    }),
    itemRepository: context.itemRepository,
    deliveryAttemptRepository: context.deliveryAttemptRepository,
    deduplicationRepository: context.deduplicationRepository,
    deliveryExecutors: context.deliveryExecutors,
    logger: context.logger,
    deliveryDispatchLogger,
  })
}
