import { assertEquals } from '@std/assert'
import { type EvaluateLogMeta, handler } from './evaluate.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

Deno.test(
  'xquery api: preview handler 应走 preview profile 并落 preview domain facts',
  async () => {
    const calls: Array<Record<string, unknown>> = []

    const response = await handler(
      new Request('http://localhost/api/xquery/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/page.html',
          entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
        }),
      }),
      {
        evaluatePlayground: () => {
          calls.push({ profile: 'preview', effectDomain: 'preview' })
          return Promise.resolve({
            warnings: [],
            fetchMeta: { ok: true },
            parser: 'xquery',
            rawContent: '<html></html>',
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

Deno.test('xquery api: POST 应返回 JSON 结果并上报成功日志元数据', async () => {
  const logs: EvaluateLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    }),
    {
      evaluatePlayground: () =>
        Promise.resolve({
          warnings: ['script 模式下 namespaces 不生效'],
          fetchMeta: { ok: true, fetchDurationMs: 12, parseDurationMs: 5 },
          parser: 'xquery',
          rawContent: '<html></html>',
          feed: {},
          entries: [{ mapped: { id: '1' } }],
        }),
      onLogMeta: (meta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('content-type'), 'application/json')
  const payload = await readJson(response)
  assertEquals(payload.parser, 'xquery')
  assertEquals(payload.rawContent, '<html></html>')
  assertEquals(logs, [
    {
      targetHost: 'example.com',
      parser: 'xquery',
      warningCount: 1,
      entryCount: 1,
      fetchDurationMs: 12,
      parseDurationMs: 5,
    },
  ])
})

Deno.test('xquery api: 非法 JSON 应返回 400 与 validation 错误体', async () => {
  const logs: EvaluateLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
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

Deno.test('xquery api: xquery 契约错误应返回 400 与结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    }),
    {
      evaluatePlayground: () => Promise.reject(new Error('__required__')),
    },
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.message, 'entry.id 必填')
  assertEquals(payload.code, 'playground_request_invalid')
  assertEquals(payload.category, 'validation')
})

Deno.test('xquery api: 抓取失败应返回 502 与结构化错误体并上报失败日志元数据', async () => {
  const logs: EvaluateLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    }),
    {
      evaluatePlayground: () =>
        Promise.reject(new Error('[source] 抓取失败 source=playground status=404')),
      onLogMeta: (meta) => logs.push(meta),
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

Deno.test('xquery api: evaluation 失败应返回 422 与结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    }),
    {
      evaluatePlayground: () => Promise.reject(new Error('xquery 表达式必须返回对象(map)')),
    },
  )

  assertEquals(response.status, 422)
  const payload = await readJson(response)
  assertEquals(payload.message, 'xquery 表达式必须返回对象(map)')
  assertEquals(payload.code, 'xquery_evaluation_failed')
  assertEquals(payload.category, 'evaluation')
})

Deno.test('xquery api: 未知错误应返回 500 与结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/xquery/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
      }),
    }),
    {
      evaluatePlayground: () => Promise.reject(new Error('unexpected boom')),
    },
  )

  assertEquals(response.status, 500)
  const payload = await readJson(response)
  assertEquals(payload.message, 'unexpected boom')
  assertEquals(payload.code, 'internal_error')
  assertEquals(payload.category, 'internal')
})
