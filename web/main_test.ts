import { assertEquals, assertStringIncludes } from '@std/assert'
import app, { withApiRequestLogging } from './main.ts'
import { createLogger } from '../src/core/logger.ts'

Deno.test('[contract] web main: 应暴露 fresh app 默认导出', () => {
  assertEquals(typeof app.listen, 'function')
})

Deno.test('[contract] web main: 应注册 syndication 页面路由', async () => {
  const response = await app.handler()(new Request('http://localhost/syndication'))

  assertEquals(response.status, 200)
  assertStringIncludes(response.headers.get('content-type') ?? '', 'text/html')
  const html = await response.text()
  assertStringIncludes(html, 'Syndication Playground')
  assertStringIncludes(html, 'id="syn-form"')
  assertStringIncludes(html, '填充默认模板')
})

Deno.test('[contract] web main: withApiRequestLogging 应记录成功请求关键字段', async () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'debug',
    module: 'web.api',
    component: 'web',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
    writeStderr: (line: string) => stdout.push(line),
  })

  const routeHandler = withApiRequestLogging(
    '/api/xquery/evaluate',
    'web.api.xquery.evaluate',
    (_request, onLogMeta) => {
      onLogMeta({
        targetHost: 'example.com',
        parser: 'xquery',
        warningCount: 1,
        entryCount: 2,
        fetchDurationMs: 12,
        parseDurationMs: 5,
      })
      return Promise.resolve(Response.json({ ok: true }))
    },
    logger,
  )

  const response = await routeHandler({
    req: new Request('http://localhost/api/xquery/evaluate', { method: 'POST' }),
  })

  assertEquals(response.status, 200)
  assertEquals(stdout.length, 2)

  const startRecord = JSON.parse(stdout[0]) as Record<string, unknown>
  const startScope = (startRecord.scope ?? {}) as Record<string, unknown>
  const startAttributes = (startRecord.attributes ?? {}) as Record<string, unknown>
  const startResource = ((startRecord.resource ?? {}) as Record<string, unknown>).attributes as
    | Record<string, unknown>
    | undefined
  assertEquals(startResource?.['knock.component'], 'web')
  assertEquals(startScope.name, 'web.api.xquery.evaluate')
  assertEquals(startAttributes['http.route'], '/api/xquery/evaluate')
  assertEquals(startAttributes['http.request.method'], 'POST')
  assertEquals(startRecord.severityText, 'DEBUG')
  assertEquals(startAttributes['web.operation'], 'request')
  assertEquals(startAttributes['web.outcome'], 'start')
  assertEquals('outcome' in startAttributes, false)
  assertEquals(typeof startAttributes['web.request_id'], 'string')
  const startRequestId = String(startAttributes['web.request_id'])

  const successRecord = JSON.parse(stdout[1]) as Record<string, unknown>
  const successScope = (successRecord.scope ?? {}) as Record<string, unknown>
  const successAttributes = (successRecord.attributes ?? {}) as Record<string, unknown>
  const successResource = ((successRecord.resource ?? {}) as Record<string, unknown>).attributes as
    | Record<string, unknown>
    | undefined
  assertEquals(successResource?.['knock.component'], 'web')
  assertEquals(successScope.name, 'web.api.xquery.evaluate')
  assertEquals(successAttributes['http.route'], '/api/xquery/evaluate')
  assertEquals(successAttributes['http.request.method'], 'POST')
  assertEquals(successAttributes['web.operation'], 'request')
  assertEquals(successAttributes['web.outcome'], 'success')
  assertEquals(typeof successAttributes['web.duration_ms'], 'number')
  assertEquals('outcome' in successAttributes, false)
  assertEquals(typeof successAttributes['web.request_id'], 'string')
  assertEquals(String(successAttributes['web.request_id']), startRequestId)
  assertEquals(successAttributes['web.target_host'], 'example.com')
  assertEquals(successAttributes['source.parser'], 'xquery')
  assertEquals(successAttributes['pipeline.warning_count'], 1)
  assertEquals(successAttributes['pipeline.entry_count'], 2)
  assertEquals(successAttributes['source.fetch_duration_ms'], 12)
  assertEquals(successAttributes['source.parse_duration_ms'], 5)
})

Deno.test(
  '[contract] web main: withApiRequestLogging 应记录 syndication 请求关键字段',
  async () => {
    const stdout: string[] = []
    const logger = createLogger({
      enabled: true,
      level: 'debug',
      module: 'web.api',
      component: 'web',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => stdout.push(line),
      writeStderr: (line: string) => stdout.push(line),
    })

    const routeHandler = withApiRequestLogging(
      '/api/syndication/evaluate',
      'web.api.syndication.evaluate',
      (_request, onLogMeta) => {
        onLogMeta({
          targetHost: 'example.com',
          parser: 'rss',
          warningCount: 1,
          entryCount: 2,
          fetchDurationMs: 12,
          parseDurationMs: 5,
        })
        return Promise.resolve(Response.json({ ok: true }))
      },
      logger,
    )

    const response = await routeHandler({
      req: new Request('http://localhost/api/syndication/evaluate', { method: 'POST' }),
    })

    assertEquals(response.status, 200)
    assertEquals(stdout.length, 2)

    const startRecord = JSON.parse(stdout[0]) as Record<string, unknown>
    const startScope = (startRecord.scope ?? {}) as Record<string, unknown>
    const startAttributes = (startRecord.attributes ?? {}) as Record<string, unknown>
    assertEquals(startScope.name, 'web.api.syndication.evaluate')
    assertEquals(startAttributes['http.route'], '/api/syndication/evaluate')
    assertEquals(startAttributes['http.request.method'], 'POST')
    assertEquals(startAttributes['web.operation'], 'request')
    assertEquals(startAttributes['web.outcome'], 'start')
    assertEquals('outcome' in startAttributes, false)

    const successRecord = JSON.parse(stdout[1]) as Record<string, unknown>
    const successScope = (successRecord.scope ?? {}) as Record<string, unknown>
    const successAttributes = (successRecord.attributes ?? {}) as Record<string, unknown>
    assertEquals(successScope.name, 'web.api.syndication.evaluate')
    assertEquals(successAttributes['http.route'], '/api/syndication/evaluate')
    assertEquals(successAttributes['http.request.method'], 'POST')
    assertEquals(successAttributes['web.operation'], 'request')
    assertEquals(successAttributes['web.outcome'], 'success')
    assertEquals(typeof successAttributes['web.duration_ms'], 'number')
    assertEquals('outcome' in successAttributes, false)
    assertEquals(successAttributes['web.target_host'], 'example.com')
    assertEquals(successAttributes['source.parser'], 'rss')
    assertEquals(successAttributes['pipeline.warning_count'], 1)
    assertEquals(successAttributes['pipeline.entry_count'], 2)
    assertEquals(successAttributes['source.fetch_duration_ms'], 12)
    assertEquals(successAttributes['source.parse_duration_ms'], 5)
  },
)

Deno.test('[contract] web main: withApiRequestLogging 应记录失败请求关键字段', async () => {
  const stderr: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'web.api',
    component: 'web',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (_line: string) => {},
    writeStderr: (line: string) => stderr.push(line),
  })

  const routeHandler = withApiRequestLogging(
    '/api/xquery/evaluate',
    'web.api.xquery.evaluate',
    (_request, onLogMeta) => {
      onLogMeta({
        targetHost: 'example.com',
        errorCode: 'playground_fetch_failed',
        errorCategory: 'fetch',
        errorMessage: '[source] 抓取失败 source=playground status=404',
      })
      return Promise.resolve(
        Response.json(
          {
            message: '抓取失败: HTTP 404',
            code: 'playground_fetch_failed',
            category: 'fetch',
          },
          { status: 502 },
        ),
      )
    },
    logger,
  )

  const response = await routeHandler({
    req: new Request('http://localhost/api/xquery/evaluate', { method: 'POST' }),
  })

  assertEquals(response.status, 502)
  assertEquals(stderr.length, 1)

  const failureRecord = JSON.parse(stderr[0]) as Record<string, unknown>
  const failureScope = (failureRecord.scope ?? {}) as Record<string, unknown>
  const failureAttributes = (failureRecord.attributes ?? {}) as Record<string, unknown>
  const failureResource = ((failureRecord.resource ?? {}) as Record<string, unknown>).attributes as
    | Record<string, unknown>
    | undefined
  assertEquals(failureResource?.['knock.component'], 'web')
  assertEquals(failureScope.name, 'web.api.xquery.evaluate')
  assertEquals(failureAttributes['http.route'], '/api/xquery/evaluate')
  assertEquals(failureAttributes['http.request.method'], 'POST')
  assertEquals(failureAttributes['web.operation'], 'request')
  assertEquals(failureAttributes['web.outcome'], 'failure')
  assertEquals(typeof failureAttributes['web.duration_ms'], 'number')
  assertEquals('outcome' in failureAttributes, false)
  assertEquals(typeof failureAttributes['web.request_id'], 'string')
  assertEquals(failureAttributes['http.response.status_code'], 502)
  assertEquals(failureAttributes['web.target_host'], 'example.com')
  assertEquals(failureAttributes['web.error_code'], 'playground_fetch_failed')
  assertEquals(failureAttributes['web.error_category'], 'fetch')
  assertEquals(
    failureAttributes['exception.message'],
    '[source] 抓取失败 source=playground status=404',
  )
})
