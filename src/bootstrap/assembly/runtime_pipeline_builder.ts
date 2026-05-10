import { RunSourceUseCase, type RunSourceUseCaseDeps } from '../../workflow/run_source_use_case.ts'
import type { DeliveryAttemptRepository } from '../../workflow/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../../workflow/ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from '../../workflow/ports/delivery_executor.ts'
import type { ItemRepository } from '../../workflow/ports/item_repository.ts'
import type { RunRepository } from '../../workflow/ports/run_repository.ts'
import type { SourceInputGateway } from '../../workflow/ports/source_input_gateway.ts'
import type { SourceParser } from '../../workflow/ports/source_parser.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'
import type { DedupeFactsStore } from '../../persistence/dedupe_facts_store.ts'
import type { RunFactsStore } from '../../persistence/run_facts_store.ts'
import { createSqliteDedupeFactsStore } from '../../persistence/sqlite/dedupe_facts_store.ts'
import { createSqliteRunFactsStore } from '../../persistence/sqlite/run_facts_store.ts'
export interface EffectPolicy {
  persistFacts: boolean
  writeDedupe: boolean
  allowExternalSideEffects: boolean
  exposeToRecovery: boolean
  exposeToPrune: boolean
}

export const previewEffectPolicy: EffectPolicy = {
  persistFacts: false,
  writeDedupe: false,
  allowExternalSideEffects: false,
  exposeToRecovery: false,
  exposeToPrune: false,
}

export const productionEffectPolicy: EffectPolicy = {
  persistFacts: true,
  writeDedupe: true,
  allowExternalSideEffects: true,
  exposeToRecovery: true,
  exposeToPrune: true,
}

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

function createNoopRunFactsStore(): RunFactsStore {
  return {
    insertRun: () => Promise.resolve(),
    updateRun: () => Promise.resolve(),
    setFeedSnapshot: () => Promise.resolve(),
    insertItems: () => Promise.resolve(),
    updateItemStatus: () => Promise.resolve(),
    insertPlannedAttempt: () => Promise.resolve(),
    finishAttempt: () => Promise.resolve(),
  }
}

function createNoopDedupeFactsStore(): DedupeFactsStore {
  return {
    isItemDuplicate: () => Promise.resolve(false),
    registerItemFingerprint: () => Promise.resolve(),
    isDeliveryDuplicate: () => Promise.resolve(false),
    registerDeliveryFingerprint: () => Promise.resolve(),
  }
}

function adaptRunFactsStore(runFacts: RunFactsStore): {
  runRepository: RunRepository
  itemRepository: ItemRepository
  deliveryAttemptRepository: DeliveryAttemptRepository
} {
  return {
    runRepository: {
      insert: (run) => runFacts.insertRun(run),
      update: (run) => runFacts.updateRun(run),
      setFeedSnapshot: (runId, feed) => runFacts.setFeedSnapshot(runId, feed),
    },
    itemRepository: {
      insertMany: (items) => runFacts.insertItems(items),
      updateStatus: (itemId, status, skippedReason) =>
        runFacts.updateItemStatus(itemId, status, skippedReason),
    },
    deliveryAttemptRepository: {
      insertPlanned: (attempt) => runFacts.insertPlannedAttempt(attempt),
      finish: (attemptId, result) => runFacts.finishAttempt(attemptId, result),
    },
  }
}

function createRuntimeRunFactsStore(input: {
  factsDb: FactsDbClient
  persistFacts: boolean
}): RunFactsStore {
  if (input.persistFacts) {
    return createSqliteRunFactsStore(input.factsDb)
  }

  return createNoopRunFactsStore()
}

function createRuntimeDedupeFactsStore(input: {
  factsDb: FactsDbClient
  writeDedupe: boolean
}): DedupeFactsStore {
  if (input.writeDedupe) {
    return createSqliteDedupeFactsStore(input.factsDb)
  }

  return createNoopDedupeFactsStore()
}

export function createRuntimePipeline(input: {
  factsDb: FactsDbClient
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
  policy: EffectPolicy
}) {
  const runFactsStore = createRuntimeRunFactsStore({
    factsDb: input.factsDb,
    persistFacts: input.policy.persistFacts,
  })
  const dedupeFactsStore = createRuntimeDedupeFactsStore({
    factsDb: input.factsDb,
    writeDedupe: input.policy.writeDedupe,
  })

  return {
    ...adaptRunFactsStore(runFactsStore),
    deduplicationRepository: dedupeFactsStore,
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
