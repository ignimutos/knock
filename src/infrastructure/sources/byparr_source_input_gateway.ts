import type { ResolvedSourceConfig } from '../../config/types.ts'
import { parseDurationMs } from '../../config/runtime_semantics.ts'
import type { HttpClient } from '../../core/http_client.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { FetchedSourceInput } from '../../application/ports/source_input_gateway.ts'

export interface ByparrSourceInputGatewayDeps {
  httpClient: HttpClient
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
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

function isByparrSourceConfig(source: ResolvedSourceConfig): source is ResolvedSourceConfig & {
  byparr: NonNullable<ResolvedSourceConfig['byparr']>
} {
  return !!source.byparr
}

async function fetchByparrText(
  source: ResolvedSourceConfig,
  httpClient: HttpClient,
): Promise<string> {
  if (!isByparrSourceConfig(source)) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=500`)
  }

  const response = await httpClient.request({
    request: source.byparr.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...toByparrProxyHeaders(source.byparr.proxy),
      },
      body: JSON.stringify({
        cmd: source.byparr.cmd,
        url: source.byparr.url,
        max_timeout: Math.floor(
          parseDurationMs(source.byparr.maxTimeout, 'source.byparr.maxTimeout') / 1000,
        ),
      }),
    },
  })

  if (!response.ok) {
    throw new Error(`[source] 抓取失败 source=${source.id} status=${response.status}`)
  }

  const payload = (await response.json()) as {
    status?: string
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

export class ByparrSourceInputGateway {
  constructor(private readonly deps: ByparrSourceInputGatewayDeps) {}

  async fetch(plan: RunPlan): Promise<FetchedSourceInput> {
    if (plan.source.kind !== 'fetch' || plan.source.fetcher !== 'byparr') {
      throw new Error('byparr source gateway 只能处理 fetch/byparr source')
    }

    const config = this.deps.resolveSourceConfig(plan.source.sourceId)
    const rawText = await fetchByparrText(config, this.deps.httpClient)

    return {
      kind: 'fetch',
      collectedAt: new Date().toISOString(),
      rawText,
      payloadSummary: {
        hash: crypto.randomUUID(),
        bytes: new TextEncoder().encode(rawText).byteLength,
      },
    }
  }
}
