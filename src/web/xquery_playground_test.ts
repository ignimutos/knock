import { assertEquals, assertRejects, assertThrows } from '../testing/assert.ts'
import {
  getCurrentWebLoggingRuntime,
  setCurrentWebLoggingRuntime,
} from '../interfaces/web/start_web.ts'
import {
  classifyPlaygroundError,
  evaluatePlayground,
  parsePlaygroundRequest,
} from './xquery_playground.ts'
import { test } from '../testing/test_api.ts'

test('[contract] xquery_playground: mapping 模式请求应转换为 xquerySchema 形状', () => {
  const parsed = parsePlaygroundRequest({
    url: 'https://example.com/page.html',
    locate: '//li',
    namespaces: { xh: 'http://www.w3.org/1999/xhtml' },
    feed: { mode: 'mapping', fields: { title: 'string(//a)' } },
    entry: { mode: 'mapping', fields: { id: 'string(@data-id)', title: 'string(a)' } },
  })

  assertEquals(parsed.source.id, 'playground')
  assertEquals(parsed.source.enabled, true)
  assertEquals(parsed.source.deliveries, {})
  assertEquals(parsed.source.http?.url, 'https://example.com/page.html')
  assertEquals(parsed.source.xquery?.entry, { id: 'string(@data-id)', title: 'string(a)' })
  assertEquals(parsed.warnings, [])
})

test('[contract] xquery_playground: byparr 模式请求应转换为 byparr source', () => {
  const parsed = parsePlaygroundRequest({
    runtime: 'byparr',
    url: 'https://example.com/page.html',
    entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
  })

  assertEquals(parsed.source.byparr?.url, 'https://example.com/page.html')
  assertEquals(parsed.source.http, undefined)
  assertEquals(parsed.source.xquery?.entry, { id: 'string(@data-id)' })
})

test('[contract] xquery_playground: script 模式 + namespaces 应产生 warning', () => {
  const parsed = parsePlaygroundRequest({
    url: 'https://example.com/page.html',
    namespaces: { xh: 'http://www.w3.org/1999/xhtml' },
    entry: { mode: 'script', code: 'map { "id": "1" }' },
  })

  assertEquals(parsed.warnings, ['script 模式下 namespaces 不生效'])
})

test('[contract] xquery_playground: 缺少 entry.id 时应沿用既有错误契约', () => {
  assertThrows(
    () =>
      parsePlaygroundRequest({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { title: 'string(a)' } },
      }),
    Error,
    '__required__',
  )
})

test('[flow] R18 xquery_playground: 应将解析后的 request 委托给 preview runtime 并透传 rawContent', async () => {
  const calls: Array<{ sourceId: string; sourceUrl: string }> = []

  const result = await evaluatePlayground({
    request: {
      url: 'https://example.com/page.html',
      locate: '//li',
      entry: { mode: 'mapping', fields: { id: 'string(@data-id)', title: 'string(a)' } },
    },
    previewExecutor: ({ config, source }) => {
      calls.push({
        sourceId: source.id,
        sourceUrl: source.http?.url ?? '',
      })
      assertEquals(config.logging, {
        level: 'info',
        sinks: {
          console: {
            type: 'console',
            format: 'jsonl',
          },
        },
      })
      return Promise.resolve({
        warnings: [],
        fetchMeta: { ok: true, payloadBytes: 13, fetchDurationMs: 12, parseDurationMs: 5 },
        parser: 'xquery',
        rawContent: '<html></html>',
        feed: {},
        entries: [{ mapped: { id: '1', title: 'Hello' } }],
      })
    },
  })

  assertEquals(calls, [
    {
      sourceId: 'playground',
      sourceUrl: 'https://example.com/page.html',
    },
  ])
  assertEquals(result.parser, 'xquery')
  assertEquals(result.rawContent, '<html></html>')
  assertEquals((result.entries[0] as { mapped: { id: string } }).mapped.id, '1')
  assertEquals(result.fetchMeta.ok, true)
})

test('[contract] xquery_playground: 应继承当前 web logging level', async () => {
  setCurrentWebLoggingRuntime({
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    logging: {
      level: 'trace',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
  })

  try {
    await evaluatePlayground({
      request: {
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      },
      previewExecutor: ({ config }) => {
        assertEquals(config.logging.level, 'trace')
        assertEquals(config.timezone, 'UTC')
        assertEquals(config.timestampFormat, 'yyyy-MM-dd HH:mm:ss')
        return Promise.resolve({
          warnings: [],
          fetchMeta: { ok: true },
          parser: 'xquery',
          rawContent: '<html></html>',
          feed: {},
          entries: [],
        })
      },
    })
  } finally {
    setCurrentWebLoggingRuntime(undefined)
    assertEquals(getCurrentWebLoggingRuntime(), undefined)
  }
})

test('[contract] xquery_playground: 应合并 parsed warnings 与 executor warnings', async () => {
  const result = await evaluatePlayground({
    request: {
      url: 'https://example.com/page.html',
      namespaces: { xh: 'http://www.w3.org/1999/xhtml' },
      entry: { mode: 'script', code: 'map { "id": "1" }' },
    },
    previewExecutor: () =>
      Promise.resolve({
        warnings: ['executor warning'],
        fetchMeta: { ok: true },
        parser: 'xquery',
        rawContent: '<html></html>',
        feed: {},
        entries: [],
      }),
  })

  assertEquals(result.warnings, ['script 模式下 namespaces 不生效', 'executor warning'])
})

test('[contract] xquery_playground: 非 previewExecutor 路径不应重复 parsed warnings', async () => {
  const result = await evaluatePlayground({
    request: {
      url: 'https://example.com/page.html',
      namespaces: { xh: 'http://www.w3.org/1999/xhtml' },
      entry: { mode: 'script', code: 'map { "id": "1" }' },
    },
    fetcher: () => Promise.resolve(new Response('<html><body></body></html>')),
  })

  assertEquals(result.warnings, ['script 模式下 namespaces 不生效'])
})

test('[contract] xquery_playground: 应拒绝 localhost 地址', () => {
  assertThrows(
    () =>
      parsePlaygroundRequest({
        url: 'http://localhost:8080/private',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    Error,
    'Playground 不允许访问内网或本机地址',
  )
})

test('[contract] xquery_playground: 应拒绝私网 IPv4 地址', () => {
  assertThrows(
    () =>
      parsePlaygroundRequest({
        url: 'http://192.168.1.10/internal',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    Error,
    'Playground 不允许访问内网或本机地址',
  )
})

test('[contract] xquery_playground: 应拒绝非 http 协议', () => {
  assertThrows(
    () =>
      parsePlaygroundRequest({
        url: 'file:///etc/passwd',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    Error,
    'Playground 仅允许 http/https URL',
  )
})

test('[contract] xquery_playground: classifyPlaygroundError 应将 __required__ 映射为 validation', () => {
  const classified = classifyPlaygroundError(new Error('__required__'))

  assertEquals(classified.status, 400)
  assertEquals(classified.code, 'playground_request_invalid')
  assertEquals(classified.category, 'validation')
  assertEquals(classified.message, 'entry.id 必填')
})

test('[contract] xquery_playground: classifyPlaygroundError 应将内网限制映射为 validation', () => {
  const classified = classifyPlaygroundError(new Error('Playground 不允许访问内网或本机地址'))

  assertEquals(classified.status, 400)
  assertEquals(classified.code, 'playground_url_blocked')
  assertEquals(classified.category, 'validation')
  assertEquals(classified.message, 'Playground 不允许访问内网或本机地址')
})

test('[contract] xquery_playground: classifyPlaygroundError 应将 __illegal__ 映射为 validation', () => {
  const classified = classifyPlaygroundError(new Error('__illegal__'))

  assertEquals(classified.status, 400)
  assertEquals(classified.code, 'playground_request_invalid')
  assertEquals(classified.category, 'validation')
  assertEquals(classified.message, 'Playground 请求非法')
})

test('[contract] xquery_playground: classifyPlaygroundError 应保留带路径的 非法 文案', () => {
  const classified = classifyPlaygroundError(new Error('xquery.entry.foo 非法'))

  assertEquals(classified.status, 400)
  assertEquals(classified.code, 'playground_request_invalid')
  assertEquals(classified.category, 'validation')
  assertEquals(classified.message, 'xquery.entry.foo 非法')
})

test('[contract] xquery_playground: classifyPlaygroundError 应将抓取失败映射为 fetch 并清洗文案', () => {
  const classified = classifyPlaygroundError(
    new Error('[source] 抓取失败 source=playground status=404'),
  )

  assertEquals(classified.status, 502)
  assertEquals(classified.code, 'playground_fetch_failed')
  assertEquals(classified.category, 'fetch')
  assertEquals(classified.message, '抓取失败: HTTP 404')
})

test('[contract] xquery_playground: classifyPlaygroundError 应将 xquery 契约错误映射为 evaluation', () => {
  const classified = classifyPlaygroundError(new Error('xquery.entry.id 必填'))

  assertEquals(classified.status, 422)
  assertEquals(classified.code, 'xquery_evaluation_failed')
  assertEquals(classified.category, 'evaluation')
  assertEquals(classified.message, 'xquery.entry.id 必填')
})

test('[contract] xquery_playground: classifyPlaygroundError 应将普通 Error 归为 internal', () => {
  const classified = classifyPlaygroundError(new Error('unexpected boom'))

  assertEquals(classified.status, 500)
  assertEquals(classified.code, 'internal_error')
  assertEquals(classified.category, 'internal')
  assertEquals(classified.message, 'unexpected boom')
})

test('[contract] xquery_playground: classifyPlaygroundError 应对非 Error 回退运行失败', () => {
  const classified = classifyPlaygroundError('boom')

  assertEquals(classified.status, 500)
  assertEquals(classified.code, 'internal_error')
  assertEquals(classified.category, 'internal')
  assertEquals(classified.message, '运行失败')
})

test('[contract] xquery_playground: evaluatePlayground 遇到非 2xx 响应时应保留底层抓取错误', async () => {
  await assertRejects(
    () =>
      evaluatePlayground({
        request: {
          url: 'https://example.com/page.html',
          entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
        },
        fetcher: () => Promise.resolve(new Response('not found', { status: 404 })),
      }),
    Error,
    '[source] 抓取失败 source=playground status=404',
  )
})

test('[contract] xquery_playground: evaluatePlayground 遇到 xquery 执行失败时应保留原始错误', async () => {
  await assertRejects(
    () =>
      evaluatePlayground({
        request: {
          url: 'https://example.com/page.html',
          entry: { mode: 'script', code: '1 + 1' },
        },
        fetcher: () => Promise.resolve(new Response('<html><body></body></html>')),
      }),
    Error,
    'Expected XPath 1 + 1 to resolve to a map',
  )
})
export const testMeta = [
  {
    title:
      '[flow] R18 xquery_playground: 应将解析后的 request 委托给 preview runtime 并透传 rawContent',
    layer: 'flow',
    risks: ['R18'],
  },
] as const
