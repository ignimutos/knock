import { z } from 'zod'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import {
  executePreviewSource,
  toPreviewExecutionResult,
} from '../interfaces/web/preview_runtime.ts'
import {
  byparrSchema,
  sourceHttpSchema,
  syndicationSchema,
  type SourceConfigInput,
} from '../config/schema.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import {
  assertPlaygroundUrlAllowed,
  classifyPlaygroundError,
  type PlaygroundErrorResult,
} from './xquery_playground.ts'

const playgroundFieldMappingSchema = z.record(z.string(), z.string())

const playgroundRequestSchema = z
  .object({
    runtime: z.enum(['native', 'byparr']).default('native'),
    url: z.string().url('url 配置非法'),
    feed: playgroundFieldMappingSchema.optional().default({}),
    entry: playgroundFieldMappingSchema.optional().default({}),
  })
  .strict()

export interface ParsedSyndicationPlaygroundRequest {
  source: SourceConfigInput & {
    id: string
    enabled: true
    deliveries: Record<string, Record<string, unknown>>
  }
  warnings: string[]
}

function hasFields(fields: Record<string, string>): boolean {
  return Object.keys(fields).length > 0
}

export function parseSyndicationPlaygroundRequest(
  input: unknown,
): ParsedSyndicationPlaygroundRequest {
  const request = parseWithFirstIssue(playgroundRequestSchema, input, 'Playground 请求非法')
  assertPlaygroundUrlAllowed(request.url)

  const mapping = parseWithFirstIssue(
    syndicationSchema,
    {
      ...(hasFields(request.feed) ? { feed: request.feed } : {}),
      ...(hasFields(request.entry) ? { entry: request.entry } : {}),
    },
    'syndication 配置非法',
  )

  const source =
    request.runtime === 'byparr'
      ? {
          id: 'playground',
          enabled: true as const,
          deliveries: {},
          byparr: parseWithFirstIssue(byparrSchema, { url: request.url }, 'byparr 配置非法'),
          syndication: mapping,
        }
      : {
          id: 'playground',
          enabled: true as const,
          deliveries: {},
          http: parseWithFirstIssue(
            sourceHttpSchema,
            {
              url: request.url,
            },
            'http 配置非法',
          ),
          syndication: mapping,
        }

  return {
    source,
    warnings: [],
  }
}

export interface EvaluateSyndicationPlaygroundInput {
  request: unknown
  fetcher?: typeof fetch
  previewExecutor?: (input: {
    config: AppConfigResolved
    source: ResolvedSourceConfig
    fetcher?: typeof fetch
  }) => Promise<{
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
  }>
}

export function classifySyndicationPlaygroundError(error: unknown): PlaygroundErrorResult {
  return classifyPlaygroundError(error)
}

export async function evaluateSyndicationPlayground(input: EvaluateSyndicationPlaygroundInput) {
  const parsed = parseSyndicationPlaygroundRequest(input.request)
  const resolvedSource: ResolvedSourceConfig = {
    ...parsed.source,
    deliveries: [],
  }
  const config: AppConfigResolved = {
    runtimeDir: Deno.cwd(),
    language: 'zh-CN',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: `${Deno.cwd()}/.tmp/playground-preview.db`,
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
    sources: [resolvedSource],
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
  }

  const previewExecutor = input.previewExecutor
  const result = previewExecutor
    ? await previewExecutor({
        config,
        source: resolvedSource,
        fetcher: input.fetcher,
      })
    : toPreviewExecutionResult({
        warnings: parsed.warnings,
        result: await executePreviewSource({
          config,
          source: resolvedSource,
          fetcher: input.fetcher,
        }),
      })

  const warnings = previewExecutor ? [...parsed.warnings, ...result.warnings] : result.warnings

  return {
    warnings,
    fetchMeta: result.fetchMeta,
    parser: result.parser,
    rawContent: result.rawContent,
    feed: result.feed,
    entries: result.entries,
  }
}
