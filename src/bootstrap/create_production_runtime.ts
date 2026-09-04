import type { RunDueSourcesUseCase } from '../workflow/run_due_sources_use_case.ts'
import type { PruneFactsResult } from '../workflow/ports/prune_facts_repository.ts'
import type { CreateTransport } from '../platform/nodemailer.ts'
import type { AppConfigResolved } from '../config/types.ts'
import type { FactsDbClient } from '../persistence/sqlite/client.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import type { Fetcher, ProxyClientFactory } from '../core/http_client.ts'
import { createProductionRuntimeServices } from './production_runtime_support.ts'

export interface ProductionRuntimeRunResult {
  started: boolean
}

export interface ProductionRuntime {
  runDueSourcesUseCase: Pick<RunDueSourcesUseCase, 'execute'>
  pruneFacts: () => Promise<PruneFactsResult>
  recoverInterruptedAttempts: () => Promise<void>
  runImmediate: () => Promise<ProductionRuntimeRunResult>
  runScheduledTick: (scheduledAt?: string) => Promise<ProductionRuntimeRunResult>
  stop: () => void
}

export interface CreateProductionRuntimeOptions {
  config: AppConfigResolved
  definitions?: DefinitionSet
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  now?: () => string
  factsDb?: FactsDbClient
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

  const runScheduledTick = async (scheduledAt?: string) => {
    return await services.scheduler.runSource('__run_due_sources__', async () => {
      await services.runDueSourcesUseCase.execute({
        trigger: 'scheduled',
        scheduledAt,
      })
    })
  }

  const pruneFacts = async (): Promise<PruneFactsResult> => {
    return await services.pruneFactsUseCase.execute({
      maxAge: options.config.sqlite.retention.maxAge,
      maxEntriesPerSource: options.config.sqlite.retention.maxEntriesPerSource,
    })
  }

  return {
    runDueSourcesUseCase: services.runDueSourcesUseCase,
    pruneFacts,
    recoverInterruptedAttempts: services.recoverInterruptedAttempts,
    async runImmediate() {
      return await services.scheduler.runSource('__run_due_sources__', async () => {
        await services.runDueSourcesUseCase.execute({
          trigger: 'immediate',
          scheduledAt: now(),
        })
      })
    },
    runScheduledTick,
    stop() {
      services.factsDb.$client.close()
    },
  }
}
