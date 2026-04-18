import { PreviewSourceUseCase } from '../application/preview_source_use_case.ts'
import type { DeliveryAttemptPlan } from '../application/ports/delivery_executor.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createInMemoryDb } from '../db/client.ts'
import { createCaptureDeliveryExecutor } from '../infrastructure/deliveries/capture_delivery_executor.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../interfaces/config/load_definitions.ts'
import {
  createRunSourceUseCaseForRuntime,
  createRuntimePipeline,
  createRuntimeSourceInputGateway,
  createSourceRuntimeSharedDeps,
} from './create_runtime_kernel.ts'

function asPreviewPushPayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('preview push payload 必须是 object')
  }
  return payload as Record<string, unknown>
}

export function createPreviewComposition(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}): {
  previewSourceUseCase: PreviewSourceUseCase
} {
  const factsDb = createInMemoryDb()
  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
    sourceConfigsById: definitions.sourceConfigsById,
  })

  const captureExecutor = createCaptureDeliveryExecutor({
    onCaptured: input.onCaptured,
  })

  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    requireFullPipeline: true,
    now: input.now ?? (() => new Date().toISOString()),
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      deliveryExecutors: {
        file: captureExecutor,
        push: captureExecutor,
        email: captureExecutor,
      },
    }),
    renderContent: (template, context) => shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(asPreviewPushPayload(payload), context),
  })

  return {
    previewSourceUseCase: new PreviewSourceUseCase({ runSourceUseCase }),
  }
}
