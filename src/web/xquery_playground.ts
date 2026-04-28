import { z } from 'zod'
import type { AppConfigResolved, ResolvedSourceConfig } from '../config/types.ts'
import type { Fetcher } from '../core/http_client.ts'
import {
  byparrSchema,
  sourceHttpSchema,
  xquerySchema,
  type SourceConfigInput,
} from '../config/schema.ts'
import type { PlaygroundPreviewResult } from './playground_preview.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'

const playgroundFieldMappingSchema = z.record(z.string(), z.string())

const playgroundSectionSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('mapping'),
      fields: playgroundFieldMappingSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('script'),
      code: z.string().min(1),
    })
    .strict(),
])

const playgroundRequestSchema = z
  .object({
    runtime: z.enum(['native', 'byparr']).default('native'),
    url: z.string().url('url 配置非法'),
    headers: z.record(z.string(), z.string()).optional(),
    locate: z.string().optional(),
    namespaces: z.record(z.string(), z.string()).optional(),
    feed: playgroundSectionSchema.optional(),
    entry: playgroundSectionSchema,
  })
  .strict()

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  )
}

export function assertPlaygroundUrlAllowed(input: string) {
  const url = new URL(input)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Playground 仅允许 http/https URL')
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Playground 不允许访问内网或本机地址')
  }

  if (isPrivateIpv4(hostname) || isBlockedIpv6(hostname)) {
    throw new Error('Playground 不允许访问内网或本机地址')
  }
}

export interface ParsedPlaygroundRequest {
  source: SourceConfigInput & {
    id: string
    enabled: true
    deliveries: Record<string, Record<string, unknown>>
  }
  warnings: string[]
}

export function parsePlaygroundRequest(input: unknown): ParsedPlaygroundRequest {
  const request = parseWithFirstIssue(playgroundRequestSchema, input, 'Playground 请求非法')
  assertPlaygroundUrlAllowed(request.url)

  const warnings: string[] = []
  const hasScriptSection = request.feed?.mode === 'script' || request.entry.mode === 'script'
  if (request.namespaces && hasScriptSection) {
    warnings.push('script 模式下 namespaces 不生效')
  }

  const xquery = parseWithFirstIssue(
    xquerySchema,
    {
      locate: request.locate,
      namespaces: request.namespaces,
      feed: request.feed?.mode === 'mapping' ? request.feed.fields : request.feed?.code,
      entry: request.entry.mode === 'mapping' ? request.entry.fields : request.entry.code,
    },
    'xquery 配置非法',
  )

  const source =
    request.runtime === 'byparr'
      ? {
          id: 'playground',
          enabled: true as const,
          deliveries: {},
          byparr: parseWithFirstIssue(byparrSchema, { url: request.url }, 'byparr 配置非法'),
          xquery,
        }
      : {
          id: 'playground',
          enabled: true as const,
          deliveries: {},
          http: parseWithFirstIssue(
            sourceHttpSchema,
            {
              url: request.url,
              headers: request.headers,
            },
            'http 配置非法',
          ),
          xquery,
        }

  return {
    source,
    warnings,
  }
}

export interface EvaluatePlaygroundInput {
  request: unknown
  fetcher?: Fetcher
  previewExecutor?: (input: {
    config: AppConfigResolved
    source: ResolvedSourceConfig
    fetcher?: Fetcher
  }) => Promise<PlaygroundPreviewResult>
}

export interface PlaygroundErrorResult {
  status: number
  message: string
  code:
    | 'playground_request_invalid'
    | 'playground_url_blocked'
    | 'playground_fetch_failed'
    | 'xquery_evaluation_failed'
    | 'internal_error'
  category: 'validation' | 'fetch' | 'evaluation' | 'internal'
}

function formatRequiredPlaygroundMessage(): string {
  return 'entry.id 必填'
}

function classifyValidationError(message: string): PlaygroundErrorResult | undefined {
  if (message === '__required__') {
    return {
      status: 400,
      message: formatRequiredPlaygroundMessage(),
      code: 'playground_request_invalid',
      category: 'validation',
    }
  }

  if (message.includes('不允许访问内网或本机地址') || message.includes('仅允许 http/https URL')) {
    return {
      status: 400,
      message,
      code: 'playground_url_blocked',
      category: 'validation',
    }
  }

  if (
    message === '__illegal__' ||
    (message.startsWith('xquery.') && message.endsWith(' 非法')) ||
    (message.startsWith('syndication.') && message.endsWith(' 非法'))
  ) {
    return {
      status: 400,
      message: message === '__illegal__' ? 'Playground 请求非法' : message,
      code: 'playground_request_invalid',
      category: 'validation',
    }
  }

  if (message.includes('请求非法') || message.includes('配置非法')) {
    return {
      status: 400,
      message,
      code: 'playground_request_invalid',
      category: 'validation',
    }
  }

  if (message.includes('必填') && !message.startsWith('xquery.')) {
    return {
      status: 400,
      message,
      code: 'playground_request_invalid',
      category: 'validation',
    }
  }

  return undefined
}

function classifyFetchError(message: string): PlaygroundErrorResult | undefined {
  const statusMatch = /\[source\]\s*抓取失败\s+source=[^\s]+\s+status=(\d+)/.exec(message)
  if (statusMatch) {
    return {
      status: 502,
      message: `抓取失败: HTTP ${statusMatch[1]}`,
      code: 'playground_fetch_failed',
      category: 'fetch',
    }
  }

  const lowered = message.toLowerCase()
  if (
    lowered.includes('timed out') ||
    lowered.includes('timeout') ||
    lowered.includes('network') ||
    lowered.includes('dns') ||
    lowered.includes('connection')
  ) {
    return {
      status: 502,
      message: `抓取失败: ${message}`,
      code: 'playground_fetch_failed',
      category: 'fetch',
    }
  }

  return undefined
}

function classifyEvaluationError(message: string): PlaygroundErrorResult | undefined {
  if (
    message.startsWith('xquery.') ||
    message.includes('xquery 表达式必须返回对象(map)') ||
    message.includes('Expected XPath')
  ) {
    return {
      status: 422,
      message,
      code: 'xquery_evaluation_failed',
      category: 'evaluation',
    }
  }

  return undefined
}

export function classifyPlaygroundError(error: unknown): PlaygroundErrorResult {
  const message = error instanceof Error ? error.message : '运行失败'

  return (
    classifyValidationError(message) ??
    classifyFetchError(message) ??
    classifyEvaluationError(message) ?? {
      status: 500,
      message,
      code: 'internal_error',
      category: 'internal',
    }
  )
}

export async function evaluatePlayground(input: EvaluatePlaygroundInput) {
  const parsed = parsePlaygroundRequest(input.request)
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
