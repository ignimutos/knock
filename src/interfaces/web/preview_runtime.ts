import { createInMemoryDb } from '../../db/client.ts'
import {
  PreviewSourceUseCase,
  type PreviewSourceRequest,
} from '../../application/preview_source_use_case.ts'
import { RunSourceUseCase } from '../../application/run_source_use_case.ts'
import { createDeliveryAttemptRepository } from '../../infrastructure/sqlite/delivery_attempt_repository.ts'
import { createApplicationDeduplicationRepository } from '../../infrastructure/sqlite/deduplication_repository.ts'
import { createItemRepository } from '../../infrastructure/sqlite/item_repository.ts'
import { createRunRepository } from '../../infrastructure/sqlite/run_repository.ts'
import { SourceParserGateway } from '../../infrastructure/sources/source_parser_gateway.ts'
import { ByparrSourceInputGateway } from '../../infrastructure/sources/byparr_source_input_gateway.ts'
import { HttpSourceInputGateway } from '../../infrastructure/sources/http_source_input_gateway.ts'
import { SummarySourceInputGateway } from '../../infrastructure/sources/summary_source_input_gateway.ts'
import { createSummaryQueryService } from '../../infrastructure/sqlite/summary_query_service.ts'
import { createContentRuntime } from '../../core/content_runtime.ts'
import { createAiRuntime } from '../../core/ai_runtime.ts'
import { createHttpClient } from '../../core/http_client.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../../config/types.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../config/load_definitions.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'
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

function resolveSourceConfig(
  sourceConfigsById: Record<string, ResolvedSourceConfig>,
  sourceId: string,
): ResolvedSourceConfig {
  const source = sourceConfigsById[sourceId]
  if (!source) {
    throw new Error(`source 未定义: ${sourceId}`)
  }
  return source
}

function selectSourceInputGateway(
  source: SourceDefinition,
  deps: {
    httpGateway: HttpSourceInputGateway
    byparrGateway: ByparrSourceInputGateway
    summaryGateway: SummarySourceInputGateway
  },
) {
  if (source.kind === 'summary') return deps.summaryGateway
  return source.fetcher === 'byparr' ? deps.byparrGateway : deps.httpGateway
}

export function createPreviewSourceUseCaseRuntime(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
}) {
  const factsDb = createInMemoryDb()
  const contentRuntime = createContentRuntime({
    aiRuntime: createAiRuntime({
      ai: input.config.ai,
      defaultLanguage: input.config.language,
    }),
  })
  const httpClient = createHttpClient({ fetcher: input.fetcher ?? fetch })
  const summaryQueryService = createSummaryQueryService(factsDb)
  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)

  const httpGateway = new HttpSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
  })
  const byparrGateway = new ByparrSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
  })
  const summaryGateway = new SummarySourceInputGateway({
    summaryQueryService,
    contentRuntime,
    language: input.config.language,
  })
  const sourceParser = new SourceParserGateway({
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
    timeOptions: {
      timezone: input.config.timezone,
      timestampFormat: input.config.timestampFormat,
    },
    language: input.config.language,
    aiRuntime: input.config.ai
      ? createAiRuntime({ ai: input.config.ai, defaultLanguage: input.config.language })
      : undefined,
    summaryQueryService,
    contentRuntime,
  })
  const now = input.now ?? (() => new Date().toISOString())
  const runSourceUseCase = new RunSourceUseCase({
    now,
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: {
      fetch: (plan) =>
        selectSourceInputGateway(plan.source, { httpGateway, byparrGateway, summaryGateway }).fetch(
          plan,
        ),
    },
    sourceParser,
    runRepository: createRunRepository(factsDb),
    itemRepository: createItemRepository(factsDb),
    deliveryAttemptRepository: createDeliveryAttemptRepository(factsDb),
    deduplicationRepository: createApplicationDeduplicationRepository(factsDb),
    deliveryExecutors: {
      file: createFileDeliveryExecutor({ runtimeDir: input.config.runtimeDir }),
      push: createHttpDeliveryExecutor({ httpClient }),
      email: createEmailDeliveryExecutor({}),
    },
    renderContent: (template, context) => contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) => contentRuntime.renderPayload(payload as never, context),
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
