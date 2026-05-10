import type { UnifiedEntryFields } from '../../config/types.ts'
import type { Logger } from '../../core/logger.ts'
import type { DeliveryAttemptRepository } from '../../workflow/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../../workflow/ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from '../../workflow/ports/delivery_executor.ts'
import type { ItemRepository } from '../../workflow/ports/item_repository.ts'
import type { RunRepository } from '../../workflow/ports/run_repository.ts'
import type { ParsedSourceSnapshot, SourceParser } from '../../workflow/ports/source_parser.ts'
import type { SourceInputGateway } from '../../workflow/ports/source_input_gateway.ts'
import type { RunSourceResult } from './run_source_contract.ts'

export interface CollectedSourceRun extends RunSourceResult {}

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

export interface RunSourceExecutionContext {
  now: () => string
  createItemId: (entry: UnifiedEntryFields) => string
  createAttemptId: (input: { sourceRunId: string; itemId: string; deliveryId: string }) => string
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
  renderContent: (template: string, context: Record<string, unknown>) => Promise<string>
  renderPayload: (payload: unknown, context: Record<string, unknown>) => Promise<unknown>
  shouldPassFilter?: RunSourceUseCaseDeps['shouldPassFilter']
  logger?: Logger
}

export interface RunSourceLifecycleCounts {
  sourceItemCount: number
  filteredCount: number
  dedupedCount: number
  pushedCount: number
  failedCount: number
}
