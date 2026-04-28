import { z } from 'zod'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { Fetcher } from '../core/http_client.ts'
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
  fetcher?: Fetcher
  previewExecutor?: (input: {
    config: AppConfigResolved
    source: ResolvedSourceConfig
    fetcher?: Fetcher
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

  const { evaluatePlaygroundPreview } = await import(
    new URL('./playground_preview.ts', import.meta.url).href
  )

  return await evaluatePlaygroundPreview({
    source: resolvedSource,
    warnings: parsed.warnings,
    fetcher: input.fetcher,
    previewExecutor: input.previewExecutor,
  })
}
