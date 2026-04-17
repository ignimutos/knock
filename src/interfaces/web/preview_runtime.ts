import { createInMemoryDb } from '../../db/client.ts'
import {
  PreviewSourceUseCase,
  type PreviewSourceRequest,
} from '../../application/preview_source_use_case.ts'
import {
  createRunSourceUseCaseForRuntime,
  createRuntimePipeline,
  createRuntimeSourceInputGateway,
  createSourceRuntimeSharedDeps,
} from '../create_source_execution_core.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../../config/types.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../config/load_definitions.ts'
import { createFileDeliveryExecutor } from '../../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../../infrastructure/deliveries/http_delivery_executor.ts'
import { createEmailDeliveryExecutor } from '../../infrastructure/deliveries/email_delivery_executor.ts'

export interface PreviewRuntimeDeps<TRequest, TParsedRequest, TResponse> {
  previewSourceUseCase: Pick<PreviewSourceUseCase, 'execute'>
  parseRequest(request: TRequest): TParsedRequest
  toResponse(input: {
    request: TRequest
    parsedRequest: TParsedRequest
    warnings: string[]
    result: Awaited<ReturnType<PreviewSourceUseCase['execute']>>
  }): TResponse
}

export interface ParsedPreviewRequest extends PreviewSourceRequest {
  warnings?: string[]
}

export interface PreviewExecutionResult {
  warnings: string[]
  fetchMeta: {
    ok: boolean
    payloadBytes?: number
    fetchDurationMs?: number
    parseDurationMs?: number
  }
  parser: string
  rawContent: string
  feed: unknown
  entries: unknown[]
  plan: {
    profile: string
    effectDomain: string
  }
}

export function createPreviewRuntime<
  TRequest,
  TParsedRequest extends ParsedPreviewRequest,
  TResponse,
>(deps: PreviewRuntimeDeps<TRequest, TParsedRequest, TResponse>) {
  return {
    async evaluate(request: TRequest): Promise<TResponse> {
      const parsedRequest = deps.parseRequest(request)
      const result = await deps.previewSourceUseCase.execute({
        source: parsedRequest.source,
        bindings: parsedRequest.bindings,
        scheduledAt: parsedRequest.scheduledAt,
      })

      return deps.toResponse({
        request,
        parsedRequest,
        warnings: parsedRequest.warnings ?? [],
        result,
      })
    },
  }
}

export function createPreviewSourceUseCaseRuntime(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
}) {
  const factsDb = createInMemoryDb()
  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
    sourceConfigsById: definitions.sourceConfigsById,
  })
  const now = input.now ?? (() => new Date().toISOString())
  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    now,
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      deliveryExecutors: {
        file: createFileDeliveryExecutor({ runtimeDir: input.config.runtimeDir }),
        push: createHttpDeliveryExecutor({ httpClient: shared.httpClient }),
        email: createEmailDeliveryExecutor({}),
      },
    }),
    renderContent: (template, context) => shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(payload as never, context),
  })

  return new PreviewSourceUseCase({ runSourceUseCase })
}

export async function executePreviewSource(input: {
  config: AppConfigResolved
  source: ResolvedSourceConfig
  fetcher?: typeof fetch
  now?: () => string
}): Promise<Awaited<ReturnType<PreviewSourceUseCase['execute']>>> {
  const previewSourceUseCase = createPreviewSourceUseCaseRuntime({
    config: input.config,
    fetcher: input.fetcher,
    now: input.now,
  })

  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)
  const sourceDefinition = definitions.sources.find((source) => source.sourceId === input.source.id)
  if (!sourceDefinition) {
    throw new Error(`source 未定义: ${input.source.id}`)
  }

  return await previewSourceUseCase.execute({
    source: sourceDefinition,
    bindings: definitions.bindings.filter((binding) => binding.sourceId === input.source.id),
  })
}

export function toPreviewExecutionResult(input: {
  warnings: string[]
  result: Awaited<ReturnType<PreviewSourceUseCase['execute']>>
}): PreviewExecutionResult {
  return {
    warnings: input.warnings,
    fetchMeta: {
      ok: true,
      payloadBytes: input.result.fetchedInput.rawText?.length,
      fetchDurationMs: undefined,
      parseDurationMs: undefined,
    },
    parser: input.result.parsed.parser,
    rawContent:
      input.result.fetchedInput.rawText ??
      JSON.stringify(input.result.fetchedInput.collectedJson ?? {}),
    feed: input.result.parsed.feed,
    entries: input.result.parsed.items.map((item) => ({ mapped: item })),
    plan: {
      profile: input.result.plan.profile,
      effectDomain: input.result.plan.effectDomain,
    },
  }
}
