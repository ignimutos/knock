import { PreviewRunUseCase } from '../application/preview_run_use_case.ts'
import type { DeliveryAttemptRepository } from '../application/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../application/ports/deduplication_repository.ts'
import type {
  DeliveryAttemptPlan,
  DeliveryExecutorRegistry,
} from '../application/ports/delivery_executor.ts'
import type { ItemRepository } from '../application/ports/item_repository.ts'
import type { RunRepository } from '../application/ports/run_repository.ts'
import type { AppConfigResolved } from '../config/types.ts'
import type { Fetcher } from '../core/http_client.ts'
import { createInMemoryDb, type FactsDbClient } from '../db/client.ts'
import { createCaptureDeliveryExecutor } from '../infrastructure/deliveries/capture_delivery_executor.ts'
import {
  createRunSourceUseCaseForRuntime,
  createSourceExecutionCore,
} from './create_runtime_kernel.ts'

function asPreviewPushPayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('preview push payload 必须是 object')
  }
  return payload as Record<string, unknown>
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

function createPreviewRunSourcePipeline(input: {
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
}) {
  return {
    runRepository: createNoopRunRepository(),
    itemRepository: createNoopItemRepository(),
    deliveryAttemptRepository: createNoopDeliveryAttemptRepository(),
    deduplicationRepository: createNoopDeduplicationRepository(),
    deliveryExecutors: input.deliveryExecutors,
  }
}

export function createPreviewRuntime(input: {
  config: AppConfigResolved
  fetcher?: Fetcher
  factsDb?: FactsDbClient
  now?: () => string
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}): {
  previewRunUseCase: PreviewRunUseCase
} {
  const factsDb = input.factsDb ?? createInMemoryDb()
  const core = createSourceExecutionCore({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
  })

  const captureExecutor = createCaptureDeliveryExecutor({
    onCaptured: input.onCaptured,
  })
  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    requireFullPipeline: true,
    now: input.now ?? (() => new Date().toISOString()),
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: core.sourceInputGateway,
    sourceParser: core.sourceParser,
    pipeline: createPreviewRunSourcePipeline({
      deliveryExecutors: {
        file: captureExecutor,
        push: captureExecutor,
        email: captureExecutor,
      },
    }),
    renderContent: core.runtimeRenderers.renderContent,
    renderPayload: (payload, context) =>
      core.runtimeRenderers.renderPayload(asPreviewPushPayload(payload), context),
  })

  return {
    previewRunUseCase: new PreviewRunUseCase({ runSourceUseCase }),
  }
}
