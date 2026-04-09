import { assertEquals } from '@std/assert'
import app, { withApiRequestLogging } from './main.ts'
import { createLogger } from '../src/core/logger.ts'

Deno.test('web main: 应暴露 fresh app 默认导出', () => {
  assertEquals(typeof app.listen, 'function')
})

Deno.test('web main: withApiRequestLogging 应记录成功请求关键字段', async () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
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
  assertEquals(startRecord.component, 'web')
  assertEquals(startRecord.module, 'web.api.xquery.evaluate')
  assertEquals(startRecord.route, '/api/xquery/evaluate')
  assertEquals(startRecord.method, 'POST')
  assertEquals(startRecord.outcome, 'start')

  const successRecord = JSON.parse(stdout[1]) as Record<string, unknown>
  assertEquals(successRecord.component, 'web')
  assertEquals(successRecord.module, 'web.api.xquery.evaluate')
  assertEquals(successRecord.route, '/api/xquery/evaluate')
  assertEquals(successRecord.method, 'POST')
  assertEquals(successRecord.outcome, 'success')
  assertEquals(successRecord.target_host, 'example.com')
  assertEquals(successRecord.parser, 'xquery')
  assertEquals(successRecord.warning_count, 1)
  assertEquals(successRecord.entry_count, 2)
  assertEquals(successRecord.fetch_duration_ms, 12)
  assertEquals(successRecord.parse_duration_ms, 5)
})

Deno.test('web main: withApiRequestLogging 应记录失败请求关键字段', async () => {
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
  assertEquals(failureRecord.component, 'web')
  assertEquals(failureRecord.module, 'web.api.xquery.evaluate')
  assertEquals(failureRecord.route, '/api/xquery/evaluate')
  assertEquals(failureRecord.method, 'POST')
  assertEquals(failureRecord.outcome, 'failure')
  assertEquals(failureRecord.http_status, 502)
  assertEquals(failureRecord.target_host, 'example.com')
  assertEquals(failureRecord.error_code, 'playground_fetch_failed')
  assertEquals(failureRecord.error_category, 'fetch')
  assertEquals(failureRecord.error_message, '[source] 抓取失败 source=playground status=404')
})
