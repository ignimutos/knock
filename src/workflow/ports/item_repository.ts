import type {
  PipelineItem,
  PipelineItemSkippedReason,
  PipelineItemStatus,
} from '../../domain/pipeline_item.ts'

export interface ItemRepository {
  insertMany(items: PipelineItem[]): Promise<void>
  updateStatus(
    itemId: string,
    status: PipelineItemStatus,
    skippedReason?: PipelineItemSkippedReason,
  ): Promise<void>
}
