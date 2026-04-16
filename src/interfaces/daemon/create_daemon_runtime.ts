import { Cron } from 'croner'
import type nodemailer from 'nodemailer'
import type { AppConfigResolved, ResolvedSourceConfig } from '../../config/types.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../config/load_definitions.ts'
import { createAiRuntime } from '../../core/ai_runtime.ts'
import { createContentRuntime } from '../../core/content_runtime.ts'
import { createHttpClient } from '../../core/http_client.ts'
import { createLogger } from '../../core/logger.ts'
import { createScheduler } from '../../core/scheduler.ts'
import { RunDueSourcesUseCase } from '../../application/run_due_sources_use_case.ts'
import { RunSourceUseCase } from '../../application/run_source_use_case.ts'
import { createFactsDbClient } from '../../db/client.ts'
import { createDeliveryAttemptRepository } from '../../infrastructure/sqlite/delivery_attempt_repository.ts'
import { createApplicationDeduplicationRepository } from '../../infrastructure/sqlite/deduplication_repository.ts'
import { createItemRepository } from '../../infrastructure/sqlite/item_repository.ts'
import { createRunRepository } from '../../infrastructure/sqlite/run_repository.ts'
import { createSummaryQueryService } from '../../infrastructure/sqlite/summary_query_service.ts'
import { markInterruptedAttempts } from '../../infrastructure/sqlite/recovery.ts'
import { createEmailDeliveryExecutor } from '../../infrastructure/deliveries/email_delivery_executor.ts'
import { createEmailDelivery } from '../../deliveries/email.ts'
import { createFileDeliveryExecutor } from '../../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../../infrastructure/deliveries/http_delivery_executor.ts'
import { ByparrSourceInputGateway } from '../../infrastructure/sources/byparr_source_input_gateway.ts'
import { HttpSourceInputGateway } from '../../infrastructure/sources/http_source_input_gateway.ts'
import { SourceParserGateway } from '../../infrastructure/sources/source_parser_gateway.ts'
import { SummarySourceInputGateway } from '../../infrastructure/sources/summary_source_input_gateway.ts'
import type { SourceQueryService } from '../../application/ports/query_service.ts'
import type { SourceDefinition } from '../../domain/source_definition.ts'

export interface CreateDaemonRuntimeOptions {
  config: AppConfigResolved
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

export interface DaemonRuntime {
  runDueSourcesUseCase: Pick<RunDueSourcesUseCase, 'execute'>
  recoverInterruptedAttempts: () => Promise<void>
  runImmediate: () => Promise<void>
  enterDaemon: () => Promise<void>
  stop: () => void
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

function createSourceQueryService(config: AppConfigResolved): SourceQueryService {
  const definitions = buildLoadedDefinitionsFromResolvedConfig(config)
  const sourceConfigs = Object.values(definitions.sourceConfigsById)

  return {
    getSource: (sourceId) =>
      Promise.resolve(definitions.sources.find((source) => source.sourceId === sourceId)),
    getBindings: (sourceId) =>
      Promise.resolve(definitions.bindings.filter((binding) => binding.sourceId === sourceId)),
    listDueSources: (at) => {
      const dueSources = sourceConfigs
        .filter((source) => source.enabled)
        .filter((source) => {
          if (!source.schedule) return false
          return new Cron(source.schedule, { paused: true, timezone: config.timezone }).match(at)
        })
        .map((source) => ({
          source: definitions.sources.find((item) => item.sourceId === source.id)!,
          bindings: definitions.bindings.filter((binding) => binding.sourceId === source.id),
        }))

      return Promise.resolve(dueSources)
    },
  }
}

export function createDaemonRuntime(options: CreateDaemonRuntimeOptions): DaemonRuntime {
  const logger = createLogger({
    enabled: true,
    level: options.config.logging.level,
    module: 'app.startup',
    component: 'daemon',
    timezone: options.config.timezone,
    timestampFormat: options.config.timestampFormat,
  })
  const scheduler = createScheduler(logger.child({ module: 'scheduler.source' }))
  const aiRuntime = createAiRuntime({
    ai: options.config.ai,
    defaultLanguage: options.config.language,
    logger: logger.child({ module: 'core.ai.runtime' }),
  })
  const contentRuntime = createContentRuntime({
    aiRuntime,
    logger: logger.child({ module: 'content.render' }),
  })
  const factsDb = createFactsDbClient({
    sqlite: options.config.sqlite,
    logger: logger.child({ module: 'db.sqlite' }),
  })
  const summaryQueryService = createSummaryQueryService(factsDb)
  const httpClient = createHttpClient({
    fetcher: options.httpFetcher ?? fetch,
    proxyClientFactory: options.httpProxyClientFactory ?? Deno.createHttpClient,
  })
  const httpGateway = new HttpSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
    logger: logger.child({ module: 'source.fetch.http' }),
  })
  const byparrGateway = new ByparrSourceInputGateway({
    httpClient,
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
    logger: logger.child({ module: 'source.fetch.byparr' }),
  })
  const summaryGateway = new SummarySourceInputGateway({
    summaryQueryService,
    contentRuntime,
    language: options.config.language,
  })
  const sourceParser = new SourceParserGateway({
    resolveSourceConfig: (sourceId) => resolveSourceConfig(definitions.sourceConfigsById, sourceId),
    timeOptions: {
      timezone: options.config.timezone,
      timestampFormat: options.config.timestampFormat,
    },
    language: options.config.language,
    aiRuntime,
    summaryQueryService,
    contentRuntime,
    logger: logger.child({ module: 'source.parse' }),
  })
  const runSourceUseCase = new RunSourceUseCase({
    now: () => new Date().toISOString(),
    createRunId: () => crypto.randomUUID(),
    sourceInputGateway: {
      fetch: (plan) =>
        selectSourceInputGateway(plan.source, {
          httpGateway,
          byparrGateway,
          summaryGateway,
        }).fetch(plan),
    },
    sourceParser,
    runRepository: createRunRepository(factsDb),
    itemRepository: createItemRepository(factsDb),
    deliveryAttemptRepository: createDeliveryAttemptRepository(factsDb),
    deduplicationRepository: createApplicationDeduplicationRepository(factsDb),
    deliveryExecutors: {
      file: createFileDeliveryExecutor({
        runtimeDir: options.config.runtimeDir,
        logger: logger.child({ module: 'delivery.file' }),
      }),
      push: createHttpDeliveryExecutor({
        httpClient,
        logger: logger.child({ module: 'delivery.http' }),
      }),
      email: createEmailDeliveryExecutor({
        logger: logger.child({ module: 'delivery.email' }),
        delivery: createEmailDelivery({
          logger: logger.child({ module: 'delivery.email' }),
          createTransport: options.emailTransportFactory,
        }),
      }),
    },
    renderContent: (template, context) => contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) => contentRuntime.renderPayload(payload as never, context),
    shouldPassFilter: ({ item, feed, source, filterTemplate }) =>
      contentRuntime.shouldPassFilter(
        filterTemplate,
        contentRuntime.buildContext(item, feed, {
          id: source.id,
          name: source.title,
          enabled: true,
          deliveries: [],
          ...(source.runtime ? { runtime: source.runtime } : {}),
        } as ResolvedSourceConfig),
      ),
    logger: logger.child({ module: 'scheduler.source' }),
  })
  const definitions = buildLoadedDefinitionsFromResolvedConfig(options.config)
  const sourceQueryService = createSourceQueryService(options.config)
  const sourceConfigs = Object.values(definitions.sourceConfigsById)
  const runDueSourcesUseCase = new RunDueSourcesUseCase({
    now: () => new Date().toISOString(),
    sourceQueryService,
    runSourceUseCase,
  })
  const scheduledJobs: Cron[] = []

  return {
    runDueSourcesUseCase,
    recoverInterruptedAttempts: () => markInterruptedAttempts(factsDb, new Date().toISOString()),
    async runImmediate() {
      const enabledSources = sourceConfigs.filter((source) => source.enabled)
      for (const source of enabledSources) {
        await scheduler.runSource(source.id, async () => {
          const sourceDefinition = await sourceQueryService.getSource(source.id)
          if (!sourceDefinition) {
            throw new Error(`source 未定义: ${source.id}`)
          }

          await runSourceUseCase.execute({
            source: sourceDefinition,
            profile: 'production',
            effectDomain: 'production',
            trigger: 'immediate',
            scheduledAt: new Date().toISOString(),
            bindings: await sourceQueryService.getBindings(source.id),
          })
        })
      }
    },
    async enterDaemon() {
      for (const source of sourceConfigs) {
        if (!source.enabled || !source.schedule) continue
        scheduledJobs.push(
          new Cron(
            source.schedule,
            { protect: true, timezone: options.config.timezone },
            async () => {
              await scheduler.runSource(source.id, async () => {
                const sourceDefinition = await sourceQueryService.getSource(source.id)
                if (!sourceDefinition) {
                  throw new Error(`source 未定义: ${source.id}`)
                }
                const sourceBindings = await sourceQueryService.getBindings(source.id)

                await runSourceUseCase.execute({
                  source: sourceDefinition,
                  profile: 'production',
                  effectDomain: 'production',
                  trigger: 'scheduled',
                  scheduledAt: new Date().toISOString(),
                  bindings: sourceBindings,
                })
              })
            },
          ),
        )
      }

      const shouldKeepAlive = options.keepAlive ?? true
      if (!shouldKeepAlive) return
      await (options.keepAliveSignal ?? new Promise(() => {}))
    },
    stop() {
      for (const job of scheduledJobs) {
        job.stop()
      }
      factsDb.$client.close()
    },
  }
}
