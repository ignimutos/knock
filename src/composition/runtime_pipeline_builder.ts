import {
  RunSourceUseCase,
  type RunSourceUseCaseDeps,
} from '../application/run_source/run_source_use_case.ts'
import type { DeliveryAttemptRepository } from '../application/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../application/ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from '../application/ports/delivery_executor.ts'
import type { ItemRepository } from '../application/ports/item_repository.ts'
import type { RunRepository } from '../application/ports/run_repository.ts'
import type { SourceInputGateway } from '../application/ports/source_input_gateway.ts'
import type { SourceParser } from '../application/ports/source_parser.ts'
import type { FactsDbClient } from '../db/client.ts'
import { createDeliveryAttemptRepository } from '../infrastructure/sqlite/delivery_attempt_repository.ts'
import { createApplicationDeduplicationRepository } from '../infrastructure/sqlite/deduplication_repository.ts'
import { createItemRepository } from '../infrastructure/sqlite/item_repository.ts'
import { createRunRepository } from '../infrastructure/sqlite/run_repository.ts'
import { previewEffectPolicy, productionEffectPolicy, type EffectPolicy } from './effect_policy.ts'

function assertFullPipeline(input: {
  runRepository?: RunRepository
  itemRepository?: ItemRepository
  deliveryAttemptRepository?: DeliveryAttemptRepository
  deduplicationRepository?: DeduplicationRepository
  deliveryExecutors?: Partial<DeliveryExecutorRegistry>
}): asserts input is {
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
  deduplicationRepository: DeduplicationRepository
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
} {
  if (
    !input.runRepository ||
    !input.itemRepository ||
    !input.deliveryAttemptRepository ||
    !input.deduplicationRepository ||
    !input.deliveryExecutors?.file ||
    !input.deliveryExecutors?.push ||
    !input.deliveryExecutors?.email
  ) {
    throw new Error('production run source wiring 缺少完整 pipeline 依赖')
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
  requireFullPipeline?: boolean
  pipeline?: {
    runRepository?: RunRepository
    itemRepository?: ItemRepository
    deliveryAttemptRepository?: DeliveryAttemptRepository
    deduplicationRepository?: DeduplicationRepository
    deliveryExecutors?: Partial<DeliveryExecutorRegistry>
  }
}): RunSourceUseCase {
  const pipeline = input.pipeline ?? {}
  if (input.requireFullPipeline) {
    assertFullPipeline(pipeline)
  }

  return new RunSourceUseCase({
    now: input.now,
    createRunId: input.createRunId,
    sourceInputGateway: input.sourceInputGateway,
    sourceParser: input.sourceParser,
    runRepository: pipeline.runRepository,
    itemRepository: pipeline.itemRepository,
    deliveryAttemptRepository: pipeline.deliveryAttemptRepository,
    deduplicationRepository: pipeline.deduplicationRepository,
    deliveryExecutors: pipeline.deliveryExecutors,
    renderContent: input.renderContent,
    renderPayload: input.renderPayload,
    shouldPassFilter: input.shouldPassFilter,
    logger: input.logger,
  })
}

function createNoopRunRepository(): RunRepository {
  return {
    insert: () => Promise.resolve(),
    update: () => Promise.resolve(),
  }
}

function createNoopItemRepository(): ItemRepository {
  return {
    insertMany: () => Promise.resolve(),
    updateStatus: () => Promise.resolve(),
  }
}

function createNoopDeliveryAttemptRepository(): DeliveryAttemptRepository {
  return {
    insertPlanned: () => Promise.resolve(),
    finish: () => Promise.resolve(),
  }
}

function createNoopDeduplicationRepository(): DeduplicationRepository {
  return {
    isItemDuplicate: () => Promise.resolve(false),
    registerItemFingerprint: () => Promise.resolve(),
    isDeliveryDuplicate: () => Promise.resolve(false),
    registerDeliveryFingerprint: () => Promise.resolve(),
  }
}

function createRuntimePersistence(input: { factsDb: FactsDbClient; persistFacts: boolean }): {
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
} {
  if (input.persistFacts) {
    return {
      runRepository: createRunRepository(input.factsDb),
      itemRepository: createItemRepository(input.factsDb),
      deliveryAttemptRepository: createDeliveryAttemptRepository(input.factsDb),
    }
  }

  return {
    runRepository: createNoopRunRepository(),
    itemRepository: createNoopItemRepository(),
    deliveryAttemptRepository: createNoopDeliveryAttemptRepository(),
  }
}

function createRuntimeDeduplicationRepository(input: {
  factsDb: FactsDbClient
  writeDedupe: boolean
}): DeduplicationRepository {
  if (input.writeDedupe) {
    return createApplicationDeduplicationRepository(input.factsDb)
  }

  return createNoopDeduplicationRepository()
}

export function createRuntimePipeline(input: {
  factsDb: FactsDbClient
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
  policy: EffectPolicy
}) {
  return {
    ...createRuntimePersistence({
      factsDb: input.factsDb,
      persistFacts: input.policy.persistFacts,
    }),
    deduplicationRepository: createRuntimeDeduplicationRepository({
      factsDb: input.factsDb,
      writeDedupe: input.policy.writeDedupe,
    }),
    deliveryExecutors: input.deliveryExecutors,
  }
}

export function createProductionRuntimePipeline(input: {
  factsDb: FactsDbClient
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
}) {
  return createRuntimePipeline({
    factsDb: input.factsDb,
    deliveryExecutors: input.deliveryExecutors,
    policy: productionEffectPolicy,
  })
}

export function createPreviewRuntimePipeline(input: {
  factsDb: FactsDbClient
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
}) {
  return createRuntimePipeline({
    factsDb: input.factsDb,
    deliveryExecutors: input.deliveryExecutors,
    policy: previewEffectPolicy,
  })
}
