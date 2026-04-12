import { z } from 'zod'
import type { ResolvedSourceConfig } from '../config/types.ts'
import {
  byparrSchema,
  sourceHttpSchema,
  syndicationSchema,
  type SourceConfigInput,
} from '../config/schema.ts'
import { createHttpClient } from '../core/http_client.ts'
import { fetchAndParseSource } from '../sources/source_runtime.ts'
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
  fetchAndParseSourceImpl?: typeof fetchAndParseSource
}

export function classifySyndicationPlaygroundError(error: unknown): PlaygroundErrorResult {
  return classifyPlaygroundError(error)
}

export async function evaluateSyndicationPlayground(input: EvaluateSyndicationPlaygroundInput) {
  const parsed = parseSyndicationPlaygroundRequest(input.request)
  const httpClient = createHttpClient({ fetcher: input.fetcher ?? fetch })
  const runFetchAndParseSource = input.fetchAndParseSourceImpl ?? fetchAndParseSource
  const resolvedSource: ResolvedSourceConfig = {
    ...parsed.source,
    deliveries: [],
  }

  const result = await runFetchAndParseSource({
    source: resolvedSource,
    httpClient,
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    },
  })

  return {
    warnings: parsed.warnings,
    fetchMeta: {
      ok: true,
      payloadBytes: result.payload.length,
      fetchDurationMs: result.timing.fetchDurationMs,
      parseDurationMs: result.timing.parseDurationMs,
    },
    parser: result.parser,
    rawContent: result.payload,
    feed: result.feedMapped,
    entries: result.entries,
  }
}
