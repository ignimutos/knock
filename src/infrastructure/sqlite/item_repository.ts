import { eq } from 'drizzle-orm'
import type { ItemRepository as ApplicationItemRepository } from '../../application/ports/item_repository.ts'
import type {
  PipelineItem,
  PipelineItemSkippedReason,
  PipelineItemStatus,
} from '../../domain/pipeline_item.ts'
import type { FactsDbClient } from '../../db/client.ts'
import { pipelineItems } from './schema.ts'

export function insertPipelineItem(db: FactsDbClient, item: PipelineItem): Promise<void> {
  db.insert(pipelineItems)
    .values({
      itemId: item.itemId,
      sourceRunId: item.sourceRunId,
      sourceId: item.sourceId,
      effectDomain: item.effectDomain,
      normalizedJson: JSON.stringify(item.normalized),
      status: item.status,
      skippedReason: item.skippedReason ?? null,
    })
    .run()

  return Promise.resolve()
}

export function updatePipelineItemStatus(
  db: FactsDbClient,
  itemId: string,
  status: PipelineItemStatus,
  skippedReason?: PipelineItemSkippedReason,
): Promise<void> {
  db.update(pipelineItems)
    .set({ status, skippedReason: skippedReason ?? null })
    .where(eq(pipelineItems.itemId, itemId))
    .run()
  return Promise.resolve()
}

export function createItemRepository(db: FactsDbClient): ApplicationItemRepository {
  return {
    insertMany: (items) =>
      Promise.all(items.map((item) => insertPipelineItem(db, item))).then(() => {}),
    updateStatus: (itemId, status, skippedReason) =>
      updatePipelineItemStatus(db, itemId, status, skippedReason),
  }
}
