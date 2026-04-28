import { Cron } from '../platform/croner.ts'
import { RunDueSourcesUseCase } from '../application/run_due_sources_use_case.ts'
import { RunSourceUseCase, type RunSourceUseCaseDeps } from '../application/run_source_use_case.ts'
import type { DeliveryAttemptRepository } from '../application/ports/delivery_attempt_repository.ts'
import type { DeduplicationRepository } from '../application/ports/deduplication_repository.ts'
import type { DeliveryExecutorRegistry } from '../application/ports/delivery_executor.ts'
import type { ItemRepository } from '../application/ports/item_repository.ts'
import type { RunRepository } from '../application/ports/run_repository.ts'
import type { SourceInputGateway } from '../application/ports/source_input_gateway.ts'
import type { SourceParser } from '../application/ports/source_parser.ts'
import type { SourceQueryService } from '../application/ports/query_service.ts'
import { createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createHttpClient, type CreateHttpClientOptions } from '../core/http_client.ts'
import type { Logger } from '../core/logger.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { FactsDbClient } from '../db/client.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import { previewEffectPolicy, productionEffectPolicy, type EffectPolicy } from './effect_policy.ts'
import { resolveSourceConfig, selectSourceInputGateway } from './runtime_source_helpers.ts'
import { createDeliveryAttemptRepository } from '../infrastructure/sqlite/delivery_attempt_repository.ts'
import { createApplicationDeduplicationRepository } from '../infrastructure/sqlite/deduplication_repository.ts'
import { createItemRepository } from '../infrastructure/sqlite/item_repository.ts'
import { createRunRepository } from '../infrastructure/sqlite/run_repository.ts'
import { createSummaryQueryService } from '../infrastructure/sqlite/summary_query_service.ts'
import { ByparrSourceInputGateway } from '../infrastructure/sources/byparr_source_input_gateway.ts'
import { HttpSourceInputGateway } from '../infrastructure/sources/http_source_input_gateway.ts'
import { SourceParserGateway } from '../infrastructure/sources/source_parser_gateway.ts'
import { SummarySourceInputGateway } from '../infrastructure/sources/summary_source_input_gateway.ts'

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

export interface RuntimeKernel {
  sourceQueryService: SourceQueryService
  runDueSourcesUseCase: RunDueSourcesUseCase
  sourceConfigs: ResolvedSourceConfig[]
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

export function createRuntimeRenderers(shared: SourceRuntimeSharedDeps): {
  renderContent: NonNullable<RunSourceUseCaseDeps['renderContent']>
  renderPayload: NonNullable<RunSourceUseCaseDeps['renderPayload']>
} {
  return {
    renderContent: (template, context) => shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(payload as never, context),
  }
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

export function createRuntimeKernel(input: {
  config: AppConfigResolved
  definitions: DefinitionSet
  now: () => string
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
}): RuntimeKernel {
  const sourceConfigs = input.config.sources
  const sourceById = new Map(
    input.definitions.sources.map((source) => [source.sourceId, source] as const),
  )
  const bindingsBySourceId = new Map<string, (typeof input.definitions.bindings)[number][]>()

  for (const binding of input.definitions.bindings) {
    const existing = bindingsBySourceId.get(binding.sourceId) ?? []
    existing.push(binding)
    bindingsBySourceId.set(binding.sourceId, existing)
  }

  const sourceQueryService: SourceQueryService = {
    getSource: (sourceId) => Promise.resolve(sourceById.get(sourceId)),
    getBindings: (sourceId) => Promise.resolve(bindingsBySourceId.get(sourceId) ?? []),
    listDueSources: (at, trigger) => {
      const dueSources = []

      for (const sourceConfig of sourceConfigs) {
        if (!sourceConfig.enabled) continue
        if (trigger === 'scheduled') {
          if (!sourceConfig.schedule) continue
          if (
            !new Cron(sourceConfig.schedule, {
              paused: true,
              timezone: input.config.timezone,
            }).match(at)
          ) {
            continue
          }
        }

        const source = sourceById.get(sourceConfig.id)
        if (!source) {
          throw new Error(`source 未定义: ${sourceConfig.id}`)
        }

        dueSources.push({
          source,
          bindings: bindingsBySourceId.get(sourceConfig.id) ?? [],
        })
      }

      return Promise.resolve(dueSources)
    },
  }

  return {
    sourceQueryService,
    runDueSourcesUseCase: new RunDueSourcesUseCase({
      now: input.now,
      sourceQueryService,
      runSourceUseCase: input.runSourceUseCase,
    }),
    sourceConfigs,
  }
}
