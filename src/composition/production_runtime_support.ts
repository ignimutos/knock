import { PruneFactsUseCase } from '../application/prune_facts_use_case.ts'
import { QueryRunsUseCase } from '../application/query_runs_use_case.ts'
import type { CreateTransport } from '../platform/nodemailer.ts'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { Fetcher, ProxyClientFactory } from '../core/http_client.ts'
import { createLogger, type Logger } from '../core/logger.ts'
import { createScheduler } from '../core/scheduler.ts'
import { createDbClient, type FactsDbClient } from '../db/client.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import { createEmailDelivery } from '../deliveries/email.ts'
import { createEmailDeliveryExecutor } from '../infrastructure/deliveries/email_delivery_executor.ts'
import { createFileDeliveryExecutor } from '../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../infrastructure/deliveries/http_delivery_executor.ts'
import { createPruneFactsRepository } from '../infrastructure/sqlite/prune_facts_repository.ts'
import { markInterruptedAttempts } from '../infrastructure/sqlite/recovery.ts'
import { createSourceRunQueryService } from '../infrastructure/sqlite/source_run_query_service.ts'
import {
  createProductionRuntimePipeline,
  createRunSourceUseCaseForRuntime,
  createRuntimeKernel,
  createSourceExecutionCore,
} from './create_runtime_kernel.ts'

export interface ProductionRuntimeLoggers {
  root: Logger
  db: Logger
  ai: Logger
  content: Logger
  parser: Logger
  sourceHttp: Logger
  sourceByparr: Logger
  deliveryFile: Logger
  deliveryHttp: Logger
  deliveryEmail: Logger
  scheduler: Logger
}

export interface CreateProductionRuntimeServicesInput {
  config: AppConfigResolved
  definitions?: DefinitionSet
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  now: () => string
  factsDb?: FactsDbClient
}

export interface ProductionRuntimeServices {
  factsDb: FactsDbClient
  scheduler: ReturnType<typeof createScheduler>
  runDueSourcesUseCase: ReturnType<typeof createRuntimeKernel>['runDueSourcesUseCase']
  queryRunsUseCase: QueryRunsUseCase
  pruneFactsUseCase: PruneFactsUseCase
  recoverInterruptedAttempts: () => Promise<void>
}

function createProductionRuntimeLoggers(config: AppConfigResolved): ProductionRuntimeLoggers {
  const root = createLogger({
    enabled: true,
    level: config.logging.level,
    module: 'app.startup',
    component: 'daemon',
    timezone: config.timezone,
    timestampFormat: config.timestampFormat,
  })

  return {
    root,
    db: root.child({ module: 'db.sqlite' }),
    ai: root.child({ module: 'core.ai.runtime' }),
    content: root.child({ module: 'content.render' }),
    parser: root.child({ module: 'source.parse' }),
    sourceHttp: root.child({ module: 'source.fetch.http' }),
    sourceByparr: root.child({ module: 'source.fetch.byparr' }),
    deliveryFile: root.child({ module: 'delivery.file' }),
    deliveryHttp: root.child({ module: 'delivery.http' }),
    deliveryEmail: root.child({ module: 'delivery.email' }),
    scheduler: root.child({ module: 'scheduler.source' }),
  }
}

function createProductionSourceExecutionCore(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
  loggers: ProductionRuntimeLoggers
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
}) {
  return createSourceExecutionCore({
    config: input.config,
    factsDb: input.factsDb,
    fetcher: input.httpFetcher ?? fetch,
    proxyClientFactory: input.httpProxyClientFactory,
    aiLogger: input.loggers.ai,
    contentLogger: input.loggers.content,
    parserLogger: input.loggers.parser,
    httpLogger: input.loggers.sourceHttp,
    byparrLogger: input.loggers.sourceByparr,
  })
}

function createProductionDeliveryExecutors(input: {
  config: AppConfigResolved
  core: ReturnType<typeof createSourceExecutionCore>
  loggers: ProductionRuntimeLoggers
  emailTransportFactory?: CreateTransport
}) {
  return {
    file: createFileDeliveryExecutor({
      runtimeDir: input.config.runtimeDir,
      logger: input.loggers.deliveryFile,
    }),
    push: createHttpDeliveryExecutor({
      httpClient: input.core.shared.httpClient,
      logger: input.loggers.deliveryHttp,
    }),
    email: createEmailDeliveryExecutor({
      logger: input.loggers.deliveryEmail,
      delivery: createEmailDelivery({
        logger: input.loggers.deliveryEmail,
        createTransport: input.emailTransportFactory,
      }),
    }),
  }
}

function createRuntimeFilterSource(source: {
  id: string
  title: string
  runtime?: { window?: { scheduledAt: string } }
}): ResolvedSourceConfig {
  return {
    id: source.id,
    name: source.title,
    enabled: true,
    deliveries: [],
    ...(source.runtime ? { runtime: source.runtime } : {}),
  } as ResolvedSourceConfig
}

function createProductionRunSourceUseCase(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
  now: () => string
  loggers: ProductionRuntimeLoggers
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
}) {
  const core = createProductionSourceExecutionCore({
    config: input.config,
    factsDb: input.factsDb,
    loggers: input.loggers,
    httpFetcher: input.httpFetcher,
    httpProxyClientFactory: input.httpProxyClientFactory,
  })

  return createRunSourceUseCaseForRuntime({
    now: input.now,
    createRunId: () => crypto.randomUUID(),
    sourceInputGateway: core.sourceInputGateway,
    sourceParser: core.sourceParser,
    pipeline: createProductionRuntimePipeline({
      factsDb: input.factsDb,
      deliveryExecutors: createProductionDeliveryExecutors({
        config: input.config,
        core,
        loggers: input.loggers,
        emailTransportFactory: input.emailTransportFactory,
      }),
    }),
    ...core.runtimeRenderers,
    shouldPassFilter: ({ item, feed, source, filterTemplate }) =>
      core.shared.contentRuntime.shouldPassFilter(
        filterTemplate,
        core.shared.contentRuntime.buildContext(item, feed, createRuntimeFilterSource(source)),
      ),
    logger: input.loggers.scheduler,
    requireFullPipeline: true,
  })
}

export function createProductionRuntimeServices(
  input: CreateProductionRuntimeServicesInput,
): ProductionRuntimeServices {
  const loggers = createProductionRuntimeLoggers(input.config)
  const factsDb =
    input.factsDb ??
    createDbClient({
      sqlite: input.config.sqlite,
      logger: loggers.db,
    })
  const definitionSet = input.definitions ?? compileDefinitionsFromResolvedConfig(input.config)
  const runSourceUseCase = createProductionRunSourceUseCase({
    config: input.config,
    factsDb,
    now: input.now,
    loggers,
    httpFetcher: input.httpFetcher,
    httpProxyClientFactory: input.httpProxyClientFactory,
    emailTransportFactory: input.emailTransportFactory,
  })
  const kernel = createRuntimeKernel({
    config: input.config,
    definitions: definitionSet,
    now: input.now,
    runSourceUseCase,
  })

  return {
    factsDb,
    scheduler: createScheduler(loggers.scheduler),
    runDueSourcesUseCase: kernel.runDueSourcesUseCase,
    queryRunsUseCase: new QueryRunsUseCase({
      sourceRunQueryService: createSourceRunQueryService(factsDb),
    }),
    pruneFactsUseCase: new PruneFactsUseCase({
      now: input.now,
      pruneFactsRepository: createPruneFactsRepository(factsDb),
    }),
    recoverInterruptedAttempts: () => markInterruptedAttempts(factsDb, input.now()),
  }
}
