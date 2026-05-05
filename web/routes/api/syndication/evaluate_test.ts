import { assertEquals } from '../../../../src/testing/assert.ts'
import { type EvaluateLogMeta, handler } from './evaluate.ts'
import { test } from '../../../../src/testing/test_api.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test('[flow] R19 syndication api: 应将请求 payload 原样转发给 evaluatePlayground', async () => {
  const calls: Array<{ request: unknown }> = []

  const requestPayload = {
    url: 'https://example.com/feed.xml',
    entry: { id: '{{ id }}' },
  }

  const response = await handler(
    new Request('http://localhost/api/syndication/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }),
    {
      evaluatePlayground: (input) => {
        calls.push(input)
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
  assertEquals(calls, [{ request: requestPayload }])
})

test('[flow] R19 syndication api: POST 应返回 JSON 结果并上报成功日志元数据', async () => {
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
  assertEquals(
    Object.keys(payload).sort(),
    ['entries', 'feed', 'fetchMeta', 'parser', 'rawContent', 'warnings'].sort(),
  )
  assertEquals('plan' in payload, false)
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

test('[flow] R20 syndication api: 非法 JSON 应返回 400 与 validation 错误体', async () => {
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

test('[flow] R19 syndication api: 抓取失败应返回 502 与结构化错误体并上报失败日志元数据', async () => {
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
})
export const testMeta = [
  {
    title: '[flow] R19 syndication api: 应将请求 payload 原样转发给 evaluatePlayground',
    layer: 'flow',
    risks: ['R19'],
  },
  {
    title: '[flow] R19 syndication api: POST 应返回 JSON 结果并上报成功日志元数据',
    layer: 'flow',
    risks: ['R19'],
  },
  {
    title: '[flow] R20 syndication api: 非法 JSON 应返回 400 与 validation 错误体',
    layer: 'flow',
    risks: ['R20'],
  },
  {
    title: '[flow] R19 syndication api: 抓取失败应返回 502 与结构化错误体并上报失败日志元数据',
    layer: 'flow',
    risks: ['R19'],
  },
] as const
