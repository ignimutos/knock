import { RunSourceUseCase, type RunSourceUseCaseDeps } from '../../workflow/run_source_use_case.ts'
import type { DeliveryAttemptRepository } from '../../workflow/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../../workflow/ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from '../../workflow/ports/delivery_executor.ts'
import type { ItemRepository } from '../../workflow/ports/item_repository.ts'
import type { RunRepository } from '../../workflow/ports/run_repository.ts'
import type { SourceInputGateway } from '../../workflow/ports/source_input_gateway.ts'
import type { SourceParser } from '../../workflow/ports/source_parser.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'
import { createDeliveryAttemptRepository } from '../../persistence/sqlite/delivery_attempt_repository.ts'
import { createApplicationDeduplicationRepository } from '../../persistence/sqlite/deduplication_repository.ts'
import { createItemRepository } from '../../persistence/sqlite/item_repository.ts'
import { createRunRepository } from '../../persistence/sqlite/run_repository.ts'

export interface RunSourcePipeline {
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: DeliveryExecutorRegistry
}

export function createProductionRuntimePipeline(input: {
  factsDb: FactsDbClient
  deliveryExecutors: DeliveryExecutorRegistry
}): RunSourcePipeline {
  return {
    runRepository: createRunRepository(input.factsDb),
    itemRepository: createItemRepository(input.factsDb),
    deliveryAttemptRepository: createDeliveryAttemptRepository(input.factsDb),
    deduplicationRepository: createApplicationDeduplicationRepository(input.factsDb),
    deliveryExecutors: input.deliveryExecutors,
  }
}

export function createRunSourceUseCaseForRuntime(input: {
  now: RunSourceUseCaseDeps['now']
  createRunId: RunSourceUseCaseDeps['createRunId']
  sourceInputGateway: SourceInputGateway
  sourceParser: SourceParser
  renderContent?: RunSourceUseCaseDeps['renderContent']
  renderPayload?: RunSourceUseCaseDeps['renderPayload']
  shouldPassFilter?: RunSourceUseCaseDeps['shouldPassFilter']
  logger?: RunSourceUseCaseDeps['logger']
  pipeline: RunSourcePipeline
}): RunSourceUseCase {
  return new RunSourceUseCase({
    now: input.now,
    createRunId: input.createRunId,
    sourceInputGateway: input.sourceInputGateway,
    sourceParser: input.sourceParser,
    runRepository: input.pipeline.runRepository,
    itemRepository: input.pipeline.itemRepository,
    deliveryAttemptRepository: input.pipeline.deliveryAttemptRepository,
    deduplicationRepository: input.pipeline.deduplicationRepository,
    deliveryExecutors: input.pipeline.deliveryExecutors,
    renderContent: input.renderContent,
    renderPayload: input.renderPayload,
    shouldPassFilter: input.shouldPassFilter,
    logger: input.logger,
  })
}
