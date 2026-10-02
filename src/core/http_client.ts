import ky, { type Input as KyInput, type Options as KyOptions } from 'ky'
import { parseDurationMs } from '../config/runtime_semantics.ts'
import type { HttpTransportConfig } from '../config/schema.ts'

const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504] as const

type RetryTransportConfig = NonNullable<HttpTransportConfig['retry']>

export interface ProxyClient {
  close(): void
}

export interface ProxyClientFactoryOptions {
  proxy: {
    url: string
  }
}

export type ProxyClientFactory = (options: ProxyClientFactoryOptions) => ProxyClient

export interface HttpRequestInput {
  transport?: HttpTransportConfig
  request: RequestInfo | URL
  init?: RequestInit
}

export interface HttpClient {
  request(input: HttpRequestInput): Promise<Response>
  fetchText(input: HttpRequestInput): Promise<string>
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface CreateHttpClientOptions {
  fetcher?: Fetcher
  proxyClientFactory?: ProxyClientFactory
}

function toKyRetryConfig(retry: RetryTransportConfig | undefined) {
  if (!retry) return 0

  return {
    limit: retry.limit,
    statusCodes: retry.statusCodes,
    retryOnTimeout: retry.retryOnTimeout,
    backoffLimit: parseDurationMs(retry.backoffLimit, 'transport.retry.backoffLimit'),
    methods: ['get', 'post', 'put', 'patch', 'delete', 'head'],
  }
}

export function createHttpClient(options: CreateHttpClientOptions = {}): HttpClient {
  const fetcher = options.fetcher ?? fetch
  const proxyClientFactory = options.proxyClientFactory

  return {
    async request(input: HttpRequestInput): Promise<Response> {
      const transport = input.transport
      if (transport?.proxy && !proxyClientFactory) {
        throw new Error('当前运行时不支持 transport.proxy')
      }

      const proxyClient = transport?.proxy
        ? proxyClientFactory?.({
            proxy: {
              url: transport.proxy,
            },
          })
        : undefined

      const transportFetch = (request: KyInput, init?: KyOptions) => {
        if (!proxyClient) {
          return fetcher(request as RequestInfo | URL, init as unknown as RequestInit)
        }

        const requestInit = init as unknown as RequestInit
        return fetcher(
          request as RequestInfo | URL,
          {
            ...requestInit,
            client: proxyClient,
          } as unknown as RequestInit,
        )
      }

      const timeoutMs = transport?.timeout
        ? parseDurationMs(transport.timeout, 'transport.timeout')
        : false
      const retryConfig = toKyRetryConfig(transport?.retry)

      try {
        const kyOptions = {
          ...input.init,
          fetch: transportFetch,
          timeout: timeoutMs,
          retry: retryConfig,
          throwHttpErrors: false,
        } as unknown as KyOptions
        return await ky(input.request as KyInput, kyOptions)
      } finally {
        proxyClient?.close()
      }
    },

    async fetchText(input: HttpRequestInput): Promise<string> {
      const response = await this.request(input)
      return await response.text()
    },
  }
}

export const DEFAULT_HTTP_RETRY = {
  limit: 2,
  statusCodes: [...DEFAULT_RETRY_STATUS_CODES],
  retryOnTimeout: true,
  backoffLimit: '3s',
} as const
