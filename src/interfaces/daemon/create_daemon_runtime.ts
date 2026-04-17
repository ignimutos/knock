import { Cron } from 'croner'
import type nodemailer from 'nodemailer'
import type { AppConfigResolved, ResolvedSourceConfig } from '../../config/types.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../config/load_definitions.ts'
import { createLogger } from '../../core/logger.ts'
import { createScheduler } from '../../core/scheduler.ts'
import { RunDueSourcesUseCase } from '../../application/run_due_sources_use_case.ts'
import { createFactsDbClient } from '../../db/client.ts'
import {
  createRunSourceUseCaseForRuntime,
  createRuntimePipeline,
  createRuntimeSourceInputGateway,
  createSourceRuntimeSharedDeps,
} from '../create_source_execution_core.ts'
import { markInterruptedAttempts } from '../../infrastructure/sqlite/recovery.ts'
import { createEmailDeliveryExecutor } from '../../infrastructure/deliveries/email_delivery_executor.ts'
import { createEmailDelivery } from '../../deliveries/email.ts'
import { createFileDeliveryExecutor } from '../../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../../infrastructure/deliveries/http_delivery_executor.ts'
import type { SourceQueryService } from '../../application/ports/query_service.ts'

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
  const definitions = buildLoadedDefinitionsFromResolvedConfig(options.config)
  const factsDb = createFactsDbClient({
    sqlite: options.config.sqlite,
    logger: logger.child({ module: 'db.sqlite' }),
  })
  const shared = createSourceRuntimeSharedDeps({
    config: options.config,
    factsDb,
    sourceConfigsById: definitions.sourceConfigsById,
    fetcher: options.httpFetcher ?? fetch,
    proxyClientFactory: options.httpProxyClientFactory ?? Deno.createHttpClient,
    aiLogger: logger.child({ module: 'core.ai.runtime' }),
    contentLogger: logger.child({ module: 'content.render' }),
    parserLogger: logger.child({ module: 'source.parse' }),
    httpLogger: logger.child({ module: 'source.fetch.http' }),
    byparrLogger: logger.child({ module: 'source.fetch.byparr' }),
  })
  const contentRuntime = shared.contentRuntime
  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    now: () => new Date().toISOString(),
    createRunId: () => crypto.randomUUID(),
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
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
    requireFullPipeline: true,
  })
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
