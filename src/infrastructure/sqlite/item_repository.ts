import type { ItemRepository as ApplicationItemRepository } from '../../application/ports/item_repository.ts'
import type {
  PipelineItem,
  PipelineItemSkippedReason,
  PipelineItemStatus,
} from '../../domain/pipeline_item.ts'
import type { FactsDbClient } from '../../db/client.ts'

export function insertPipelineItem(db: FactsDbClient, item: PipelineItem): Promise<void> {
  db.$client
    .prepare(
      `
        INSERT INTO pipeline_items (
          item_id,
          source_run_id,
          source_id,
          effect_domain,
          normalized_json,
          status,
          skipped_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      item.itemId,
      item.sourceRunId,
      item.sourceId,
      item.effectDomain,
      JSON.stringify(item.normalized),
      item.status,
      item.skippedReason ?? null,
    )

  return Promise.resolve()
}

export function updatePipelineItemStatus(
  db: FactsDbClient,
  itemId: string,
  status: PipelineItemStatus,
  skippedReason?: PipelineItemSkippedReason,
): Promise<void> {
  db.$client
    .prepare(
      `
        UPDATE pipeline_items
        SET status = ?, skipped_reason = ?
        WHERE item_id = ?
      `,
    )
    .run(status, skippedReason ?? null, itemId)
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
