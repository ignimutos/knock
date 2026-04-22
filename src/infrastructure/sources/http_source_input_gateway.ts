import type { ResolvedSourceConfig } from '../../config/types.ts'
import type { HttpClient } from '../../core/http_client.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { FetchedSourceInput } from '../../application/ports/source_input_gateway.ts'
import type { Logger } from '../../core/logger.ts'

export interface HttpSourceInputGatewayDeps {
  httpClient: HttpClient
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
  logger?: Logger
}

function isHttpSourceConfig(source: ResolvedSourceConfig): source is ResolvedSourceConfig & {
  http: NonNullable<ResolvedSourceConfig['http']>
} {
  return !!source.http
}

async function fetchHttpText(
  source: ResolvedSourceConfig,
  httpClient: HttpClient,
): Promise<string> {
  if (!isHttpSourceConfig(source)) {
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

export class HttpSourceInputGateway {
  constructor(private readonly deps: HttpSourceInputGatewayDeps) {}

  async fetch(plan: RunPlan): Promise<FetchedSourceInput> {
    if (plan.source.kind !== 'fetch' || plan.source.fetcher !== 'http') {
      throw new Error('http source gateway 只能处理 fetch/http source')
    }

    const config = this.deps.resolveSourceConfig(plan.source.sourceId)
    const startedAt = Date.now()

    this.deps.logger?.trace('source payload 抓取开始', {
      module: 'source.fetch.http',
      'source.operation': 'fetch_payload',
      'source.outcome': 'start',
      'source.id': config.id,
    })

    try {
      const rawText = await fetchHttpText(config, this.deps.httpClient)
      const payloadBytes = new TextEncoder().encode(rawText).byteLength

      this.deps.logger?.info('source payload 抓取完成', {
        module: 'source.fetch.http',
        'source.operation': 'fetch_payload',
        'source.outcome': 'success',
        'source.id': config.id,
        'source.fetch_duration_ms': Date.now() - startedAt,
        'source.payload_bytes': payloadBytes,
      })

      return {
        kind: 'fetch',
        collectedAt: new Date().toISOString(),
        rawText,
        payloadSummary: {
          hash: crypto.randomUUID(),
          bytes: payloadBytes,
        },
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.deps.logger?.error('source payload 抓取失败', {
        module: 'source.fetch.http',
        'source.operation': 'fetch_payload',
        'source.outcome': 'failure',
        'source.id': config.id,
        error_name: normalizedError.name,
        error_message: 'http source fetch failed',
        'source.fetch_duration_ms': Date.now() - startedAt,
      })
      throw error
    }
  }
}
