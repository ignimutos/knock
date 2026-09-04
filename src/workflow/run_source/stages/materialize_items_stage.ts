import { createPipelineItem, type PipelineItem } from '../../../domain/pipeline_item.ts'
import type { SourceRun } from '../../../domain/source_run.ts'
import type {
  CollectedSourceRun,
  RunSourceExecutionContext,
} from '../run_source_execution_types.ts'

export async function materializeItemsStage(
  run: SourceRun,
  collected: CollectedSourceRun,
  context: RunSourceExecutionContext,
): Promise<PipelineItem[]> {
  const items = collected.parsed.items.map((entry) =>
    createPipelineItem({
      itemId: context.createItemId(entry),
      sourceRunId: run.runId,
      sourceId: run.sourceId,
      effectDomain: run.effectDomain,
      normalized: entry,
    }),
  )

  await context.itemRepository.insertMany(items)
  return items
}
