import type { SourceInputGateway } from '../application/ports/source_input_gateway.ts'
import type { SourceParser } from '../application/ports/source_parser.ts'
import type { RunSourceUseCaseDeps } from '../application/run_source/run_source_use_case.ts'
import { createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createHttpClient, type CreateHttpClientOptions } from '../core/http_client.ts'
import type { Logger } from '../core/logger.ts'
import type { HttpPayload } from '../config/schema.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { FactsDbClient } from '../db/client.ts'
import { createSummaryQueryService } from '../infrastructure/sqlite/summary_query_service.ts'
import { ByparrSourceInputGateway } from '../infrastructure/sources/byparr_source_input_gateway.ts'
import { HttpSourceInputGateway } from '../infrastructure/sources/http_source_input_gateway.ts'
import { SourceParserGateway } from '../infrastructure/sources/source_parser_gateway.ts'
import { SummarySourceInputGateway } from '../infrastructure/sources/summary_source_input_gateway.ts'
import { resolveSourceConfig, selectSourceInputGateway } from './runtime_source_helpers.ts'

export interface SourceRuntimeSharedDeps {
  sourceConfigsById: Record<string, ResolvedSourceConfig>
  httpGateway: HttpSourceInputGateway
  byparrGateway: ByparrSourceInputGateway
  summaryGateway: SummarySourceInputGateway
  sourceParser: SourceParserGateway
  contentRuntime: ReturnType<typeof createContentRuntime>
  aiRuntime: ReturnType<typeof createAiRuntime>
  summaryQueryService: ReturnType<typeof createSummaryQueryService>
  httpClient: ReturnType<typeof createHttpClient>
}

export interface SourceExecutionCore {
  shared: SourceRuntimeSharedDeps
  sourceInputGateway: SourceInputGateway
  sourceParser: SourceParser
  runtimeRenderers: {
    renderContent: NonNullable<RunSourceUseCaseDeps['renderContent']>
    renderPayload: NonNullable<RunSourceUseCaseDeps['renderPayload']>
  }
}

function indexSourceConfigsById(
  sources: ResolvedSourceConfig[],
): Record<string, ResolvedSourceConfig> {
  return Object.fromEntries(sources.map((source) => [source.id, source]))
}

export function createSourceRuntimeSharedDeps(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
  sourceConfigsById: Record<string, ResolvedSourceConfig>
  fetcher?: CreateHttpClientOptions['fetcher']
  proxyClientFactory?: CreateHttpClientOptions['proxyClientFactory']
  generateText?: Parameters<typeof createAiRuntime>[0]['generateText']
  aiLogger?: Logger
  contentLogger?: Logger
  parserLogger?: Logger
  httpLogger?: Logger
  byparrLogger?: Logger
}): SourceRuntimeSharedDeps {
  const aiRuntime = createAiRuntime({
    ai: input.config.ai,
    defaultLanguage: input.config.language,
    logger: input.aiLogger,
    generateText: input.generateText,
  })
  const contentRuntime = createContentRuntime({
    aiRuntime,
    logger: input.contentLogger,
  })
  const httpClient = createHttpClient({
    fetcher: input.fetcher,
    proxyClientFactory: input.proxyClientFactory,
  })
  const summaryQueryService = createSummaryQueryService(input.factsDb)

  const httpGateway = new HttpSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(input.sourceConfigsById, sourceId),
    logger: input.httpLogger,
  })
  const byparrGateway = new ByparrSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(input.sourceConfigsById, sourceId),
    logger: input.byparrLogger,
  })
  const summaryGateway = new SummarySourceInputGateway({
    summaryQueryService,
    contentRuntime,
    language: input.config.language,
  })
  const sourceParser = new SourceParserGateway({
    resolveSourceConfig: (sourceId) => resolveSourceConfig(input.sourceConfigsById, sourceId),
    timeOptions: {
      timezone: input.config.timezone,
      timestampFormat: input.config.timestampFormat,
    },
    language: input.config.language,
    aiRuntime: input.config.ai ? aiRuntime : undefined,
    summaryQueryService,
    contentRuntime,
    logger: input.parserLogger,
  })

  return {
    sourceConfigsById: input.sourceConfigsById,
    httpGateway,
    byparrGateway,
    summaryGateway,
    sourceParser,
    contentRuntime,
    aiRuntime,
    summaryQueryService,
    httpClient,
  }
}

export function createRuntimeSourceInputGateway(
  shared: SourceRuntimeSharedDeps,
): SourceInputGateway {
  return {
    fetch: (plan) =>
      selectSourceInputGateway(plan.source, {
        httpGateway: shared.httpGateway,
        byparrGateway: shared.byparrGateway,
        summaryGateway: shared.summaryGateway,
      }).fetch(plan),
  }
}

function asHttpPayload(payload: unknown): HttpPayload | undefined {
  return payload as HttpPayload | undefined
}

export function createRuntimeRenderers(shared: SourceRuntimeSharedDeps): {
  renderContent: NonNullable<RunSourceUseCaseDeps['renderContent']>
  renderPayload: NonNullable<RunSourceUseCaseDeps['renderPayload']>
} {
  return {
    renderContent: (template, context) => shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(asHttpPayload(payload), context),
  }
}

export function createSourceExecutionCore(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
  fetcher?: CreateHttpClientOptions['fetcher']
  proxyClientFactory?: CreateHttpClientOptions['proxyClientFactory']
  generateText?: Parameters<typeof createAiRuntime>[0]['generateText']
  aiLogger?: Logger
  contentLogger?: Logger
  parserLogger?: Logger
  httpLogger?: Logger
  byparrLogger?: Logger
}): SourceExecutionCore {
  const shared = createSourceRuntimeSharedDeps({
    ...input,
    sourceConfigsById: indexSourceConfigsById(input.config.sources),
  })

  return {
    shared,
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    runtimeRenderers: createRuntimeRenderers(shared),
  }
}
