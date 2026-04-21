import { PruneFactsUseCase } from '../application/prune_facts_use_case.ts'
import { QueryRunsUseCase } from '../application/query_runs_use_case.ts'
import { Cron } from 'croner'
import type nodemailer from 'nodemailer'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import { createLogger, type Logger } from '../core/logger.ts'
import { createScheduler } from '../core/scheduler.ts'
import { createFactsDbClient, type FactsDbClient } from '../db/client.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
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

export interface ProductionRuntime {
  runDueSourcesUseCase: {
    execute: ReturnType<typeof createRuntimeKernel>['runDueSourcesUseCase']['execute']
  }
  queryRunsUseCase: QueryRunsUseCase
  pruneFactsUseCase: PruneFactsUseCase
  recoverInterruptedAttempts: () => Promise<void>
  runImmediate: () => Promise<void>
  enterDaemon: () => Promise<void>
  stop: () => void
}

export interface CreateProductionRuntimeOptions {
  config: AppConfigResolved
  definitions?: DefinitionSet
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  now?: () => string
  factsDb?: FactsDbClient
  runDueSourcesUseCase?: ProductionRuntime['runDueSourcesUseCase']
  scheduleDueSources?: (task: () => Promise<void>) => { stop: () => void }
}

interface ProductionRuntimeLoggers {
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
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
}) {
  return createSourceExecutionCore({
    config: input.config,
    factsDb: input.factsDb,
    fetcher: input.httpFetcher ?? fetch,
    proxyClientFactory: input.httpProxyClientFactory ?? Deno.createHttpClient,
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
  emailTransportFactory?: typeof nodemailer.createTransport
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

function createProductionRunSourceUseCase(input: {
  config: AppConfigResolved
  factsDb: FactsDbClient
  now: () => string
  loggers: ProductionRuntimeLoggers
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
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
        core.shared.contentRuntime.buildContext(item, feed, {
          id: source.id,
          name: source.title,
          enabled: true,
          deliveries: [],
          ...(source.runtime ? { runtime: source.runtime } : {}),
        } as ResolvedSourceConfig),
      ),
    logger: input.loggers.scheduler,
    requireFullPipeline: true,
  })
}

export function createProductionRuntime(
  options: CreateProductionRuntimeOptions,
): ProductionRuntime {
  const now = options.now ?? (() => new Date().toISOString())
  const loggers = createProductionRuntimeLoggers(options.config)
  const factsDb =
    options.factsDb ??
    createFactsDbClient({
      sqlite: options.config.sqlite,
      logger: loggers.db,
    })
  const definitionSet = options.definitions ?? compileDefinitionsFromResolvedConfig(options.config)
  const runSourceUseCase = createProductionRunSourceUseCase({
    config: options.config,
    factsDb,
    now,
    loggers,
    httpFetcher: options.httpFetcher,
    httpProxyClientFactory: options.httpProxyClientFactory,
    emailTransportFactory: options.emailTransportFactory,
  })
  const scheduler = createScheduler(loggers.scheduler)
  const kernel = createRuntimeKernel({
    config: options.config,
    definitions: definitionSet,
    now,
    runSourceUseCase,
  })
  const runDueSourcesUseCase = options.runDueSourcesUseCase ?? kernel.runDueSourcesUseCase
  const queryRunsUseCase = new QueryRunsUseCase({
    sourceRunQueryService: createSourceRunQueryService(factsDb),
  })
  const pruneFactsUseCase = new PruneFactsUseCase({
    now,
    pruneFactsRepository: createPruneFactsRepository(factsDb),
  })
  const scheduledJobs: { stop: () => void }[] = []
  const scheduleDueSources =
    options.scheduleDueSources ??
    ((task: () => Promise<void>) =>
      new Cron('* * * * * *', { protect: true, timezone: options.config.timezone }, task))

  return {
    runDueSourcesUseCase,
    queryRunsUseCase,
    pruneFactsUseCase,
    recoverInterruptedAttempts: () => markInterruptedAttempts(factsDb, now()),
    async runImmediate() {
      await scheduler.runSource('__run_due_sources__', async () => {
        await runDueSourcesUseCase.execute({
          trigger: 'immediate',
          scheduledAt: now(),
        })
      })
    },
    async enterDaemon() {
      scheduledJobs.push(
        scheduleDueSources(async () => {
          await scheduler.runSource('__run_due_sources__', async () => {
            await runDueSourcesUseCase.execute({
              trigger: 'scheduled',
              scheduledAt: now(),
            })
          })
        }),
      )

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
