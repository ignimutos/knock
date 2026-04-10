import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../config/types.ts'
import type { AiRuntime } from '../core/ai_runtime.ts'
import type { HttpClient } from '../core/http_client.ts'
import { parseDurationMs } from '../config/runtime_semantics.ts'
import { parseSyndicationSource } from './syndication.ts'
import { parseXquerySource } from './xquery.ts'

export interface ParsedSourceEntry {
  mapped: UnifiedEntryFields | Record<string, string>
}

export interface ParsedSourceResult {
  feedMapped: UnifiedFeedFields | Record<string, string>
  entries: ParsedSourceEntry[]
  parser: 'rss' | 'atom' | 'json' | 'xquery' | 'none'
}

export interface FetchAndParseSourceInput {
  source: ResolvedSourceConfig
  httpClient: HttpClient
  timeOptions: {
    timezone: string
    timestampFormat: string
  }
  aiRuntime?: AiRuntime
}

export interface SourceRuntimeTiming {
  fetchDurationMs: number
  parseDurationMs: number
}

export interface FetchedParsedSourceResult extends ParsedSourceResult {
  payload: string
  timing: SourceRuntimeTiming
}

function toByparrProxyHeaders(proxyUrl?: string): HeadersInit | undefined {
  if (!proxyUrl) return undefined

  const parsed = new URL(proxyUrl)
  const username = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const proxyServer = `${parsed.protocol}//${parsed.host}`

  return {
    'X-Proxy-Server': proxyServer,
    'X-Proxy-Username': username,
    'X-Proxy-Password': password,
  }
}

async function fetchByparrPayload(
  source: ResolvedSourceConfig,
  httpClient: HttpClient,
): Promise<string> {
  const byparr = source.byparr
  if (!byparr) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=500`)
  }

  const response = await httpClient.request({
    request: byparr.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...toByparrProxyHeaders(byparr.proxy),
      },
      body: JSON.stringify({
        cmd: byparr.cmd,
        url: byparr.url,
        max_timeout: Math.floor(
          parseDurationMs(byparr.maxTimeout, 'source.byparr.maxTimeout') / 1000,
        ),
      }),
    },
  })

  if (!response.ok) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=${response.status}`)
  }

  const payload = (await response.json()) as {
    status?: string
    message?: string
    solution?: {
      status?: number
      response?: string
    }
  }

  const solutionStatus = payload.solution?.status ?? 500
  if (payload.status !== 'ok' || solutionStatus < 200 || solutionStatus >= 300) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=${solutionStatus}`)
  }

  if (typeof payload.solution?.response !== 'string') {
    throw new Error(`[source] 抓取失败 source=${source.id} status=${solutionStatus}`)
  }

  return payload.solution.response
}

async function fetchSourcePayload(
  source: ResolvedSourceConfig,
  httpClient: HttpClient,
): Promise<string> {
  if (source.byparr) {
    return await fetchByparrPayload(source, httpClient)
  }

  if (!source.http) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=500`)
  }

  const response = await httpClient.request({
    transport: source.http,
    request: source.http.url,
    init: {
      headers: source.http.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=${response.status}`)
  }

  return await response.text()
}

async function parseSourcePayload(
  source: ResolvedSourceConfig,
  payload: string,
  timeOptions: { timezone: string; timestampFormat: string },
  aiRuntime?: AiRuntime,
): Promise<ParsedSourceResult> {
  if (source.syndication) {
    const parsed = await parseSyndicationSource(payload, source.syndication, timeOptions, {
      sourceId: source.id,
      aiRuntime,
    })
    return {
      feedMapped: parsed.feed,
      entries: parsed.entries,
      parser: parsed.format,
    }
  }

  if (source.xquery) {
    const parsed = parseXquerySource(payload, source.xquery)
    return {
      feedMapped: parsed.feed.mapped,
      entries: parsed.entries,
      parser: 'xquery',
    }
  }

  return {
    feedMapped: {},
    entries: [],
    parser: 'none',
  }
}

export async function fetchAndParseSource(
  input: FetchAndParseSourceInput,
): Promise<FetchedParsedSourceResult> {
  const fetchStartedAt = Date.now()
  const payload = await fetchSourcePayload(input.source, input.httpClient)
  const fetchDurationMs = Date.now() - fetchStartedAt

  const parseStartedAt = Date.now()
  const parsed = await parseSourcePayload(input.source, payload, input.timeOptions, input.aiRuntime)
  const parseDurationMs = Date.now() - parseStartedAt

  return {
    payload,
    timing: {
      fetchDurationMs,
      parseDurationMs,
    },
    ...parsed,
  }
}
