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
import { createRunId, type Logger } from './logger.ts'
import type { Scheduler } from './scheduler.ts'

export interface SourceRuntime {
  fetchAndParse(source: ResolvedSourceConfig): Promise<FetchedParsedSourceResult>
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

export interface SourceProcessor {
  runOnce(source: ResolvedSourceConfig): Promise<void>
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
  }
}

function createFetchLogger(logger: Logger, sourceId: string, runId: string): Logger {
  return logger.child({
    module: 'source.fetch',
    source_id: sourceId,
    run_id: runId,
  })
}

function createSourceRunLogger(logger: Logger, sourceId: string, runId: string): Logger {
  return logger.child({
    module: 'scheduler.source',
    source_id: sourceId,
    run_id: runId,
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
    operation: 'parse',
    outcome: 'success',
    source_id: sourceId,
    run_id: runId,
    item_count: parsed.entries.length,
    duration_ms: durationMs,
  })
}

export function createSourceProcessor(options: CreateSourceProcessorOptions): SourceProcessor {
  const now = options.now ?? Date.now
  const createRunIdImpl = options.createRunId ?? createRunId

  return {
    async runOnce(source: ResolvedSourceConfig): Promise<void> {
      const startedAt = now()
      const runId = createRunIdImpl(source.id, new Date(startedAt))
      const sourceRunLogger = createSourceRunLogger(options.logger, source.id, runId)

      await options.scheduler.runSource(source.id, async () => {
        sourceRunLogger.info('source 开始执行', {
          operation: 'run_source',
          outcome: 'start',
        })

        try {
          const parsed = await options.sourceRuntime.fetchAndParse(source)

          createFetchLogger(options.logger, source.id, runId).info('抓取成功', {
            operation: 'fetch',
            outcome: 'success',
            duration_ms: parsed.timing.fetchDurationMs,
            payload_bytes: parsed.payload.length,
          })

          await options.sourceStateStore.persistParsedSource(
            toPersistParsedSourceInput(source.id, parsed),
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
                operation: 'validate_entry',
                outcome: 'skipped',
                source_id: source.id,
                run_id: runId,
                reason: 'entry.id_empty',
              })
              continue
            }

            const aiEntryRuntime = options.aiRuntime?.createEntryRuntime(source.id, entryId)
            const templateContext = options.contentRuntime.buildContext(
              entry,
              parsed.feedMapped,
              source,
              aiEntryRuntime,
            )

            const filterStartedAt = now()
            const passed = await options.contentRuntime.shouldPassFilter(
              source.filter,
              templateContext,
            )
            options.logger.info('filter 结果', {
              module: 'pipeline.filter',
              operation: 'filter',
              outcome: passed ? 'passed' : 'filtered',
              source_id: source.id,
              run_id: runId,
              item_id: entryId,
              duration_ms: now() - filterStartedAt,
            })

            if (!passed) continue
            passedCount += 1

            for (const delivery of source.deliveries) {
              const deliveryId = options.deliveryRuntime.getDeliveryId(delivery)
              const deliveryResult = await options.sourceStateStore.deliverIfNeeded(
                source.id,
                entryId,
                deliveryId,
                async () => {
                  await options.deliveryRuntime.push(delivery, templateContext)
                },
              )

              if (deliveryResult === 'deduped') {
                dedupedCount += 1
                options.logger.info('命中去重', {
                  module: 'delivery.store',
                  operation: 'is_delivered',
                  outcome: 'deduped',
                  source_id: source.id,
                  run_id: runId,
                  item_id: entryId,
                  delivery_id: deliveryId,
                })
                continue
              }

              options.logger.info('记录 delivered', {
                module: 'delivery.store',
                operation: 'mark_delivered',
                outcome: 'success',
                source_id: source.id,
                run_id: runId,
                item_id: entryId,
                delivery_id: deliveryId,
              })
              pushedCount += 1
            }
          }

          options.sourceStateStore.pruneSourceState(source.id, source.deliveries.length)

          sourceRunLogger.info('source 执行完成', {
            operation: 'run_source',
            outcome: 'success',
            item_count: parsed.entries.length,
            passed_count: passedCount,
            deduped_count: dedupedCount,
            pushed_count: pushedCount,
            duration_ms: now() - startedAt,
          })
        } catch (error) {
          sourceRunLogger.error('source 执行失败', {
            operation: 'run_source',
            outcome: 'failure',
            duration_ms: now() - startedAt,
            error_name: error instanceof Error ? error.name : 'Error',
            error_message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          })
          throw error
        }
      })
    },
  }
}
