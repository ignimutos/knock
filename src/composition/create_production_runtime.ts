import { PruneFactsUseCase } from '../application/prune_facts_use_case.ts'
import { QueryRunsUseCase } from '../application/query_runs_use_case.ts'
import { Cron } from 'croner'
import type nodemailer from 'nodemailer'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import { createLogger } from '../core/logger.ts'
import { createScheduler } from '../core/scheduler.ts'
import { createFactsDbClient, type FactsDbClient } from '../db/client.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'
import { createEmailDelivery } from '../deliveries/email.ts'
import { createEmailDeliveryExecutor } from '../infrastructure/deliveries/email_delivery_executor.ts'
import { createFileDeliveryExecutor } from '../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../infrastructure/deliveries/http_delivery_executor.ts'
import { createPruneFactsRepository } from '../infrastructure/sqlite/prune_facts_repository.ts'
import { markInterruptedAttempts } from '../infrastructure/sqlite/recovery.ts'
import { createSourceRunQueryService } from '../infrastructure/sqlite/source_run_query_service.ts'
import {
  createRunSourceUseCaseForRuntime,
  createRuntimePipeline,
  createRuntimeRenderers,
  createRuntimeSourceInputGateway,
  createRuntimeKernel,
  createSourceRuntimeSharedDeps,
} from './create_runtime_kernel.ts'
import { productionEffectPolicy } from './effect_policy.ts'

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

export function createProductionRuntime(
  options: CreateProductionRuntimeOptions,
): ProductionRuntime {
  const now = options.now ?? (() => new Date().toISOString())

  const logger = createLogger({
    enabled: true,
    level: options.config.logging.level,
    module: 'app.startup',
    component: 'daemon',
    timezone: options.config.timezone,
    timestampFormat: options.config.timestampFormat,
  })
  const factsDb =
    options.factsDb ??
    createFactsDbClient({
      sqlite: options.config.sqlite,
      logger: logger.child({ module: 'db.sqlite' }),
    })
  const definitionSet = compileDefinitionsFromResolvedConfig(options.config)

  const runSourceUseCase = (() => {
    const shared = createSourceRuntimeSharedDeps({
      config: options.config,
      factsDb,
      sourceConfigsById: Object.fromEntries(
        options.config.sources.map((source) => [source.id, source]),
      ),
      fetcher: options.httpFetcher ?? fetch,
      proxyClientFactory: options.httpProxyClientFactory ?? Deno.createHttpClient,
      aiLogger: logger.child({ module: 'core.ai.runtime' }),
      contentLogger: logger.child({ module: 'content.render' }),
      parserLogger: logger.child({ module: 'source.parse' }),
      httpLogger: logger.child({ module: 'source.fetch.http' }),
      byparrLogger: logger.child({ module: 'source.fetch.byparr' }),
    })

    return createRunSourceUseCaseForRuntime({
      now,
      createRunId: () => crypto.randomUUID(),
      sourceInputGateway: createRuntimeSourceInputGateway(shared),
      sourceParser: shared.sourceParser,
      pipeline: createRuntimePipeline({
        factsDb,
        policy: productionEffectPolicy,
        deliveryExecutors: {
          file: createFileDeliveryExecutor({
            runtimeDir: options.config.runtimeDir,
            logger: logger.child({ module: 'delivery.file' }),
          }),
          push: createHttpDeliveryExecutor({
            httpClient: shared.httpClient,
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
      }),
      ...createRuntimeRenderers(shared),
      shouldPassFilter: ({ item, feed, source, filterTemplate }) =>
        shared.contentRuntime.shouldPassFilter(
          filterTemplate,
          shared.contentRuntime.buildContext(item, feed, {
            id: source.id,
            name: source.title,
            enabled: true,
            deliveries: [],
            ...(source.runtime ? { runtime: source.runtime } : {}),
          } as ResolvedSourceConfig),
        ),
      logger: logger.child({ module: 'scheduler.source' }),
      requireFullPipeline: true,
    })
  })()

  const scheduler = createScheduler(logger.child({ module: 'scheduler.source' }))
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
