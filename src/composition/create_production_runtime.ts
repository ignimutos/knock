import { Cron } from '../platform/croner.ts'
import type { RunDueSourcesUseCase } from '../application/run_due_sources_use_case.ts'
import { PruneFactsUseCase } from '../application/prune_facts_use_case.ts'
import { QueryRunsUseCase } from '../application/query_runs_use_case.ts'
import type { CreateTransport } from '../platform/nodemailer.ts'
import type { AppConfigResolved } from '../config/types.ts'
import type { FactsDbClient } from '../db/client.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import type { ProxyClientFactory } from '../core/http_client.ts'
import { createProductionRuntimeServices } from './production_runtime_support.ts'

export interface ProductionRuntimeRunResult {
  started: boolean
}

export interface ProductionRuntime {
  runDueSourcesUseCase: Pick<RunDueSourcesUseCase, 'execute'>
  queryRunsUseCase: QueryRunsUseCase
  pruneFactsUseCase: PruneFactsUseCase
  recoverInterruptedAttempts: () => Promise<void>
  runImmediate: () => Promise<ProductionRuntimeRunResult>
  runSourceNow: (sourceId: string) => Promise<ProductionRuntimeRunResult>
  enterDaemon: () => Promise<void>
  stop: () => void
}

export interface CreateProductionRuntimeOptions {
  config: AppConfigResolved
  definitions?: DefinitionSet
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
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
  const services = createProductionRuntimeServices({
    config: options.config,
    definitions: options.definitions,
    httpFetcher: options.httpFetcher,
    httpProxyClientFactory: options.httpProxyClientFactory,
    emailTransportFactory: options.emailTransportFactory,
    now,
    factsDb: options.factsDb,
  })
  const runDueSourcesUseCase = options.runDueSourcesUseCase ?? services.runDueSourcesUseCase
  const scheduledJobs: { stop: () => void }[] = []
  const scheduleDueSources =
    options.scheduleDueSources ??
    ((task: () => Promise<void>) =>
      new Cron('* * * * * *', { protect: true, timezone: options.config.timezone }, task))

  return {
    runDueSourcesUseCase,
    queryRunsUseCase: services.queryRunsUseCase,
    pruneFactsUseCase: services.pruneFactsUseCase,
    recoverInterruptedAttempts: services.recoverInterruptedAttempts,
    async runImmediate() {
      return await services.scheduler.runSource('__run_due_sources__', async () => {
        await runDueSourcesUseCase.execute({
          trigger: 'immediate',
          scheduledAt: now(),
        })
      })
    },
    async runSourceNow(sourceId: string) {
      return await services.scheduler.runSource(sourceId, async () => {
        await runDueSourcesUseCase.execute({
          sourceId,
          trigger: 'manual',
          scheduledAt: now(),
        })
      })
    },
    async enterDaemon() {
      scheduledJobs.push(
        scheduleDueSources(async () => {
          await services.scheduler.runSource('__run_due_sources__', async () => {
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
      services.factsDb.$client.close()
    },
  }
}
