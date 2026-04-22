import { join } from '@std/path'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import { getCurrentWebLoggingRuntime } from '../interfaces/web/start_web.ts'
import {
  executePreviewSource,
  toPreviewExecutionResult,
} from '../interfaces/web/preview_runtime.ts'

export interface PlaygroundPreviewResult {
  warnings: string[]
  fetchMeta: {
    ok: boolean
    payloadBytes?: number
    fetchDurationMs?: number
    parseDurationMs?: number
  }
  parser: string
  rawContent: string
  feed: unknown
  entries: unknown[]
}

export interface PlaygroundPreviewExecutorInput {
  config: AppConfigResolved
  source: ResolvedSourceConfig
  fetcher?: typeof fetch
}

export function createPlaygroundConfig(source: ResolvedSourceConfig): AppConfigResolved {
  const loggingRuntime = getCurrentWebLoggingRuntime()

  return {
    runtimeDir: Deno.cwd(),
    language: 'zh-CN',
    timezone: loggingRuntime?.timezone ?? 'UTC',
    timestampFormat: loggingRuntime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: join(Deno.cwd(), '.tmp', 'playground-preview.db'),
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '1d',
        maxEntriesPerSource: 100,
        vacuum: 'off',
      },
    },
    ai: undefined,
    deliveries: [],
    sources: [source],
    logging: {
      level: loggingRuntime?.logging.level ?? 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
  }
}

export async function evaluatePlaygroundPreview(input: {
  source: ResolvedSourceConfig
  warnings: string[]
  fetcher?: typeof fetch
  previewExecutor?: (input: PlaygroundPreviewExecutorInput) => Promise<PlaygroundPreviewResult>
}): Promise<PlaygroundPreviewResult> {
  const config = createPlaygroundConfig(input.source)
  const previewExecutor = input.previewExecutor
  const result = previewExecutor
    ? await previewExecutor({
        config,
        source: input.source,
        fetcher: input.fetcher,
      })
    : toPreviewExecutionResult({
        warnings: input.warnings,
        result: await executePreviewSource({
          config,
          source: input.source,
          fetcher: input.fetcher,
        }),
      })

  return {
    ...result,
    warnings: previewExecutor ? [...input.warnings, ...result.warnings] : result.warnings,
  }
}
