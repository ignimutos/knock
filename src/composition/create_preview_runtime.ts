import { PreviewRunUseCase } from '../application/preview_run_use_case.ts'
import type { DeliveryAttemptPlan } from '../application/ports/delivery_executor.ts'
import type { AppConfigResolved } from '../config/types.ts'
import type { Fetcher } from '../core/http_client.ts'
import { createInMemoryDb, type FactsDbClient } from '../db/client.ts'
import { createCaptureDeliveryExecutor } from '../infrastructure/deliveries/capture_delivery_executor.ts'
import {
  createPreviewRuntimePipeline,
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

export function createPreviewComposition(input: {
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
    pipeline: createPreviewRuntimePipeline({
      factsDb,
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
