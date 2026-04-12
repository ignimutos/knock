import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../config/types.ts'
import type { PersistParsedSourceInput, SourceStateStore } from '../db/source_state_store.ts'
import type { DeliveryRuntime } from '../deliveries/delivery_runtime.ts'
import type { FetchedParsedSourceResult, ParsedSourceResult } from '../sources/source_runtime.ts'
import type { AiRuntime } from './ai_runtime.ts'
import type { ContentContext } from './content_runtime.ts'
import { attachLogFields, createRunId, type Logger } from './logger.ts'
import type { Scheduler } from './scheduler.ts'

export interface SourceRuntimeFetchOptions {
  scheduledAt?: string
}

export interface SourceRuntime {
  fetchAndParse(
    source: ResolvedSourceConfig,
    logger?: Logger,
    options?: SourceRuntimeFetchOptions,
  ): Promise<FetchedParsedSourceResult>
}

export interface SourceProcessorContentRuntime {
  buildContext(
    entry: UnifiedEntryFields | Record<string, string>,
    feed: UnifiedFeedFields | Record<string, string>,
    source: ResolvedSourceConfig,
    aiEntryRuntime?: ReturnType<AiRuntime['createEntryRuntime']>,
  ): ContentContext
  shouldPassFilter(filterTemplate: string | undefined, context: ContentContext): Promise<boolean>
}

export interface SourceProcessorRunOptions {
  scheduledAt?: string
}

export interface SourceProcessor {
  runOnce(source: ResolvedSourceConfig, options?: SourceProcessorRunOptions): Promise<void>
}

export interface CreateSourceProcessorOptions {
  logger: Logger
  scheduler: Scheduler
  sourceRuntime: SourceRuntime
  contentRuntime: SourceProcessorContentRuntime
  deliveryRuntime: DeliveryRuntime
  sourceStateStore: SourceStateStore
  aiRuntime?: AiRuntime
  createRunId?: typeof createRunId
  now?: () => number
}

function toEntryId(entry: UnifiedEntryFields | Record<string, string>): string {
  return `${entry.id ?? ''}`.trim()
}

function shouldSkipParsedEntry(entry: UnifiedEntryFields | Record<string, string>): boolean {
  return toEntryId(entry) === ''
}

function toPersistParsedSourceInput(
  sourceId: string,
  parsed: FetchedParsedSourceResult,
): PersistParsedSourceInput {
  return {
    sourceId,
    parser: parsed.parser,
    payload: parsed.payload,
    feedMapped: parsed.feedMapped,
    entries: parsed.entries,
    observedAt: parsed.observedAt,
  }
}

function createFetchLogger(logger: Logger, sourceId: string, runId: string): Logger {
  return logger.child({
    module: 'source.fetch',
    'source.id': sourceId,
    'source.run_id': runId,
  })
}

function createSourceRunLogger(logger: Logger, sourceId: string, runId: string): Logger {
  return logger.child({
    module: 'scheduler.source',
    'source.id': sourceId,
    'source.run_id': runId,
  })
}

function logParseSuccess(
  logger: Logger,
  sourceId: string,
  runId: string,
  parsed: ParsedSourceResult,
  durationMs: number,
): void {
  logger.info('解析完成', {
    module: `source.parse.${parsed.parser}`,
    'source.operation': 'parse',
    'source.outcome': 'success',
    'source.id': sourceId,
    'source.run_id': runId,
    'source.item_count': parsed.entries.length,
    'source.parse_duration_ms': durationMs,
  })
}

export function createSourceProcessor(options: CreateSourceProcessorOptions): SourceProcessor {
  const now = options.now ?? Date.now
  const createRunIdImpl = options.createRunId ?? createRunId

  return {
    async runOnce(
      source: ResolvedSourceConfig,
      runOptions?: SourceProcessorRunOptions,
    ): Promise<void> {
      const startedAt = now()
      const runId = createRunIdImpl(source.id, new Date(startedAt))
      const sourceRunLogger = createSourceRunLogger(options.logger, source.id, runId)

      await options.scheduler.runSource(source.id, async () => {
        sourceRunLogger.info('source 开始执行', {
          'scheduler.operation': 'run_source',
          'scheduler.outcome': 'start',
        })

        try {
          const parsed = await options.sourceRuntime.fetchAndParse(
            source,
            options.logger.child({
              module: 'source.runtime',
              'source.id': source.id,
              'source.run_id': runId,
            }),
            runOptions,
          )

          createFetchLogger(options.logger, source.id, runId).info('抓取成功', {
            'source.operation': 'fetch',
            'source.outcome': 'success',
            'source.fetch_duration_ms': parsed.timing.fetchDurationMs,
            'source.payload_bytes': new TextEncoder().encode(parsed.payload).length,
          })

          await options.sourceStateStore.persistParsedSource(
            toPersistParsedSourceInput(source.id, parsed),
            runId,
          )
          logParseSuccess(options.logger, source.id, runId, parsed, parsed.timing.parseDurationMs)

          let passedCount = 0
          let dedupedCount = 0
          let pushedCount = 0

          for (const parsedEntry of parsed.entries) {
            const entry = parsedEntry.mapped
            const entryId = toEntryId(entry)
            if (shouldSkipParsedEntry(entry)) {
              options.logger.warn('跳过无效 entry', {
                module: `source.parse.${parsed.parser}`,
                'source.operation': 'validate_entry',
                'source.outcome': 'skipped',
                'source.id': source.id,
                'source.run_id': runId,
                'source.reason': 'entry.id_empty',
              })
              continue
            }

            const itemLogFields = {
              'source.id': source.id,
              'source.run_id': runId,
              'pipeline.item_id': entryId,
            }
            const aiEntryRuntime = options.aiRuntime?.createEntryRuntime(source.id, entryId, runId)
            const templateContext = attachLogFields(
              options.contentRuntime.buildContext(entry, parsed.feedMapped, source, aiEntryRuntime),
              itemLogFields,
            )

            const filterStartedAt = now()
            const passed = await options.contentRuntime.shouldPassFilter(
              source.filter,
              templateContext,
            )
            options.logger.info('filter 结果', {
              module: 'pipeline.filter',
              'pipeline.operation': 'filter',
              'pipeline.outcome': passed ? 'passed' : 'filtered',
              ...itemLogFields,
              'pipeline.duration_ms': now() - filterStartedAt,
            })

            if (!passed) continue
            passedCount += 1

            for (const delivery of source.deliveries) {
              const deliveryId = options.deliveryRuntime.getDeliveryId(delivery)
              const deliveryLogFields = {
                ...itemLogFields,
                'delivery.id': deliveryId,
              }
              const deliveryContext = attachLogFields(templateContext, deliveryLogFields)
              const deliveryResult = await options.sourceStateStore.deliverIfNeeded(
                source.id,
                entryId,
                deliveryId,
                async () => {
                  await options.deliveryRuntime.push(delivery, deliveryContext)
                },
                runId,
              )

              if (deliveryResult === 'deduped') {
                dedupedCount += 1
                options.logger.info('命中去重', {
                  module: 'delivery.store',
                  'delivery.operation': 'is_delivered',
                  'delivery.outcome': 'deduped',
                  ...deliveryLogFields,
                })
                continue
              }

              options.logger.info('记录 delivered', {
                module: 'delivery.store',
                'delivery.operation': 'mark_delivered',
                'delivery.outcome': 'success',
                ...deliveryLogFields,
              })
              pushedCount += 1
            }
          }

          options.sourceStateStore.pruneSourceState(source.id, source.deliveries.length, runId)

          sourceRunLogger.info('source 执行完成', {
            'scheduler.operation': 'run_source',
            'scheduler.outcome': 'success',
            'source.item_count': parsed.entries.length,
            'pipeline.passed_count': passedCount,
            'delivery.deduped_count': dedupedCount,
            'delivery.pushed_count': pushedCount,
            'scheduler.duration_ms': now() - startedAt,
          })
        } catch (error) {
          const safeLogMessage =
            error instanceof Error && 'safeLogMessage' in error
              ? ((error as Error & { safeLogMessage?: string }).safeLogMessage ?? error.message)
              : error instanceof Error
                ? error.message
                : String(error)
          const safeStack =
            error instanceof Error && 'safeLogMessage' in error
              ? undefined
              : error instanceof Error
                ? error.stack
                : undefined
          sourceRunLogger.error('source 执行失败', {
            'scheduler.operation': 'run_source',
            'scheduler.outcome': 'failure',
            'scheduler.duration_ms': now() - startedAt,
            error_name: error instanceof Error ? error.name : 'Error',
            error_message: safeLogMessage,
            stack: safeStack,
          })
          throw error
        }
      })
    },
  }
}
