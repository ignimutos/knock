import { assertEquals } from '@std/assert'
import { createLogger } from './logger.ts'

Deno.test('logger: enabled=false 时不输出日志', () => {
  const stdout: string[] = []
  const stderr: string[] = []

  const logger = createLogger({
    enabled: false,
    level: 'trace',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
    writeStderr: (line: string) => stderr.push(line),
  })

  logger.info('启动完成', { operation: 'boot', outcome: 'success' })
  logger.error('启动失败', { operation: 'boot', outcome: 'failure' })

  assertEquals(stdout.length, 0)
  assertEquals(stderr.length, 0)
})

Deno.test('logger: level=warn 时过滤 info 但保留 warn/error', () => {
  const stdout: string[] = []
  const stderr: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'warn',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
    writeWarn: (line: string) => stdout.push(line),
    writeStderr: (line: string) => stderr.push(line),
  })

  logger.info('启动完成', { operation: 'boot', outcome: 'success' })
  logger.warn('重入跳过', {
    operation: 'schedule',
    outcome: 'skipped_reentry',
  })
  logger.error('启动失败', { operation: 'boot', outcome: 'failure' })

  assertEquals(stdout.length, 1)
  assertEquals(stderr.length, 1)
  assertEquals((JSON.parse(stdout[0]) as Record<string, unknown>).level, 'warn')
  assertEquals((JSON.parse(stderr[0]) as Record<string, unknown>).level, 'error')
})

Deno.test('logger: 默认输出为结构化 JSON 并包含基础字段', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    component: 'daemon',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  }).child({
    module: 'source.fetch',
    runId: 'source.rust.20260324T214512345Z',
  })

  logger.info('开始执行', {
    operation: 'fetch',
    outcome: 'success',
    sourceId: 'rust',
  })

  assertEquals(stdout.length, 1)
  const record = JSON.parse(stdout[0]) as Record<string, unknown>
  assertEquals(record.timestamp, '2026-03-24 21:45:12')
  assertEquals(record.level, 'info')
  assertEquals(record.service, 'knock')
  assertEquals(record.env, 'dev')
  assertEquals(record.component, 'daemon')
  assertEquals(record.module, 'source.fetch')
  assertEquals(record.operation, 'fetch')
  assertEquals(record.message, '开始执行')
  assertEquals(record.outcome, 'success')
  assertEquals(record.run_id, 'source.rust.20260324T214512345Z')
  assertEquals(record.source_id, 'rust')
})

Deno.test('logger: 应按配置时区格式化 timestamp', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    timezone: 'Asia/Shanghai',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('启动完成', { operation: 'boot', outcome: 'success' })

  assertEquals(stdout.length, 1)
  const record = JSON.parse(stdout[0]) as Record<string, unknown>
  assertEquals(record.timestamp, '2026-03-25 05:45:12')
})

Deno.test('logger: module 只有一个事实源并输出稳定字段名', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('解析完成', {
    module: 'source.parse.rss',
    operation: 'parse',
    outcome: 'success',
    itemCount: 2,
  })

  assertEquals(stdout.length, 1)
  const record = JSON.parse(stdout[0]) as Record<string, unknown>
  assertEquals(record.module, 'source.parse.rss')
  assertEquals(record.item_count, 2)
  assertEquals('itemCount' in record, false)
})

Deno.test('logger: component 应排在 module 前并由 child 继承', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    component: 'web',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  }).child({ module: 'web.api.xquery.evaluate', route: '/api/xquery/evaluate' })

  logger.info('API 请求开始', { operation: 'request', outcome: 'start', method: 'POST' })

  assertEquals(stdout.length, 1)
  assertEquals(
    stdout[0],
    '{"timestamp":"2026-03-24 21:45:12","level":"info","service":"knock","env":"dev","component":"web","module":"web.api.xquery.evaluate","operation":"request","message":"API 请求开始","outcome":"start","method":"POST","route":"/api/xquery/evaluate"}',
  )
})

Deno.test('logger: 敏感字段与敏感内容应脱敏', () => {
  const stderr: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'error',
    module: 'delivery.http',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStderr: (line: string) => stderr.push(line),
  })

  logger.error('发送失败', {
    operation: 'send_message',
    outcome: 'failure',
    token: '123456:ABCDEF-SECRET',
    chatId: '987654321',
    sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
    deliveryId: 'rust__webhook__0',
    url: 'https://api.telegram.org/bot123456:ABCDEF-SECRET/sendMessage?token=abc',
    body: '{"ok":false,"description":"bad token"}',
    errorMessage: 'telegram failed: token=123456:ABCDEF-SECRET chat_id=987654321 body={"ok":false}',
    stack:
      'Error: telegram failed https://api.telegram.org/bot123456:ABCDEF-SECRET/sendMessage?token=abc',
    content: 'hello secret',
  })

  assertEquals(stderr.length, 1)
  const record = JSON.parse(stderr[0]) as Record<string, unknown>
  assertEquals(record.token, '****')
  assertEquals(record.chat_id, '****')
  assertEquals(record.content, '****')
  assertEquals(record.body, '****')
  assertEquals(record.url, 'https://api.telegram.org/bot****/sendMessage')
  assertEquals(record.source_url, 'https://example.com/feed.xml')
  assertEquals(record.delivery_id, 'rust__webhook__0')
  assertEquals(record.error_message, 'telegram failed: token=**** chat_id=**** body=****')
  assertEquals(
    record.stack,
    'Error: telegram failed https://api.telegram.org/bot****/sendMessage?token=****',
  )
})
