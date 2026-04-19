import { PreviewSourceUseCase } from '../application/preview_source_use_case.ts'
import type { DeliveryAttemptPlan } from '../application/ports/delivery_executor.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createInMemoryDb, type FactsDbClient } from '../db/client.ts'
import { createCaptureDeliveryExecutor } from '../infrastructure/deliveries/capture_delivery_executor.ts'
import {
  createRunSourceUseCaseForRuntime,
  createRuntimePipeline,
  createRuntimeRenderers,
  createRuntimeSourceInputGateway,
  createSourceRuntimeSharedDeps,
} from './create_runtime_kernel.ts'
import { previewEffectPolicy } from './effect_policy.ts'

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
  factsDb?: FactsDbClient
  now?: () => string
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}): {
  previewSourceUseCase: PreviewSourceUseCase
} {
  const factsDb = input.factsDb ?? createInMemoryDb()
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
    sourceConfigsById: Object.fromEntries(
      input.config.sources.map((source) => [source.id, source]),
    ),
  })

  const captureExecutor = createCaptureDeliveryExecutor({
    onCaptured: input.onCaptured,
  })

  const runtimeRenderers = createRuntimeRenderers(shared)
  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    requireFullPipeline: true,
    now: input.now ?? (() => new Date().toISOString()),
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      policy: previewEffectPolicy,
      deliveryExecutors: {
        file: captureExecutor,
        push: captureExecutor,
        email: captureExecutor,
      },
    }),
    renderContent: runtimeRenderers.renderContent,
    renderPayload: (payload, context) =>
      runtimeRenderers.renderPayload(asPreviewPushPayload(payload), context),
  })

  return {
    previewSourceUseCase: new PreviewSourceUseCase({ runSourceUseCase }),
  }
}
