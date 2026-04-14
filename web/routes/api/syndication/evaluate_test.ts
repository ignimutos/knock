import { assertEquals } from '@std/assert'
import { type EvaluateLogMeta, handler } from './evaluate.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

Deno.test(
  '[flow] syndication api: preview handler 应走 preview profile 并落 preview domain facts',
  async () => {
    const calls: Array<Record<string, unknown>> = []

    const response = await handler(
      new Request('http://localhost/api/syndication/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/feed.xml',
          entry: { id: '{{ id }}' },
        }),
      }),
      {
        evaluatePlayground: () => {
          calls.push({ profile: 'preview', effectDomain: 'preview' })
          return Promise.resolve({
            warnings: [],
            fetchMeta: { ok: true },
            parser: 'rss',
            rawContent: '<rss></rss>',
            feed: {},
            entries: [],
          })
        },
      },
    )

    assertEquals(response.status, 200)
    assertEquals(calls, [{ profile: 'preview', effectDomain: 'preview' }])
  },
)

Deno.test('[flow] syndication api: POST 应返回 JSON 结果并上报成功日志元数据', async () => {
  const logs: EvaluateLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/syndication/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/feed.xml',
        entry: { id: '{{ id }}' },
      }),
    }),
    {
      evaluatePlayground: () =>
        Promise.resolve({
          warnings: ['示例 warning'],
          fetchMeta: { ok: true, fetchDurationMs: 12, parseDurationMs: 5 },
          parser: 'rss',
          rawContent: '<rss></rss>',
          feed: { title: 'Feed' },
          entries: [{ mapped: { id: '1' } }],
        }),
      onLogMeta: (meta: EvaluateLogMeta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.parser, 'rss')
  assertEquals(payload.rawContent, '<rss></rss>')
  assertEquals(logs, [
    {
      targetHost: 'example.com',
      parser: 'rss',
      warningCount: 1,
      entryCount: 1,
      fetchDurationMs: 12,
      parseDurationMs: 5,
    },
  ])
})

Deno.test('[flow] R20 syndication api: 非法 JSON 应返回 400 与 validation 错误体', async () => {
  const logs: EvaluateLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/syndication/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
    { onLogMeta: (meta) => logs.push(meta) },
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.message, 'Playground 请求非法')
  assertEquals(payload.code, 'playground_request_invalid')
  assertEquals(payload.category, 'validation')
  assertEquals(logs, [
    {
      errorCode: 'playground_request_invalid',
      errorCategory: 'validation',
      errorMessage: 'Playground 请求非法',
    },
  ])
})

Deno.test(
  '[flow] syndication api: 抓取失败应返回 502 与结构化错误体并上报失败日志元数据',
  async () => {
    const logs: EvaluateLogMeta[] = []

    const response = await handler(
      new Request('http://localhost/api/syndication/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/feed.xml',
          entry: { id: '{{ id }}' },
        }),
      }),
      {
        evaluatePlayground: () =>
          Promise.reject(new Error('[source] 抓取失败 source=playground status=404')),
        onLogMeta: (meta: EvaluateLogMeta) => logs.push(meta),
      },
    )

    assertEquals(response.status, 502)
    const payload = await readJson(response)
    assertEquals(payload.message, '抓取失败: HTTP 404')
    assertEquals(payload.code, 'playground_fetch_failed')
    assertEquals(payload.category, 'fetch')
    assertEquals(logs, [
      {
        targetHost: 'example.com',
        errorCode: 'playground_fetch_failed',
        errorCategory: 'fetch',
        errorMessage: '[source] 抓取失败 source=playground status=404',
      },
    ])
  },
)
