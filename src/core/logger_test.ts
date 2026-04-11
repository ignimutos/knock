import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl } from '@std/path'
import * as loggerModule from './logger.ts'

const { createLogger } = loggerModule

const loggerModuleUrl = new URL('./logger.ts', import.meta.url).href

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>
}

function getAttributes(record: Record<string, unknown>): Record<string, unknown> {
  return (record.attributes ?? {}) as Record<string, unknown>
}

function getResourceAttributes(record: Record<string, unknown>): Record<string, unknown> {
  const resource = (record.resource ?? {}) as Record<string, unknown>
  return (resource.attributes ?? {}) as Record<string, unknown>
}

function getScopeName(record: Record<string, unknown>): string | undefined {
  return ((record.scope ?? {}) as Record<string, unknown>).name as string | undefined
}

function toUnixNano(input: Date): string {
  return (BigInt(input.getTime()) * 1_000_000n).toString()
}

function buildStackWithLocation(
  options: {
    functionName?: string
    lineNumber?: number
    filepath?: string
  } = {},
): string {
  const filepath = options.filepath ?? fromFileUrl(import.meta.url)
  const lineNumber = options.lineNumber ?? 1
  const location = `${filepath}:${lineNumber}:1`
  const frame = options.functionName
    ? `    at ${options.functionName} (${location})`
    : `    at ${location}`
  return ['Error', '    at getCodeAttributes (/src/core/logger.ts:331:1)', frame].join('\n')
}

function withMockedError(buildStack: () => string, run: () => void): void {
  const OriginalError = globalThis.Error

  try {
    const MockError = class extends OriginalError {
      constructor(message?: string, options?: ErrorOptions) {
        super(message, options)
        this.stack = buildStack()
      }
    }

    globalThis.Error = MockError as unknown as ErrorConstructor
    run()
  } finally {
    globalThis.Error = OriginalError
  }
}

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

Deno.test('logger: level=warn 时过滤 info 但保留 warn/error/fatal', () => {
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
  logger.fatal('进程无法继续', { operation: 'boot', outcome: 'fatal_failure' })

  assertEquals(stdout.length, 1)
  assertEquals(stderr.length, 2)

  const warnRecord = parseRecord(stdout[0])
  const errorRecord = parseRecord(stderr[0])
  const fatalRecord = parseRecord(stderr[1])
  assertEquals(warnRecord.severityText, 'WARN')
  assertEquals(warnRecord.severityNumber, 13)
  assertEquals(errorRecord.severityText, 'ERROR')
  assertEquals(errorRecord.severityNumber, 17)
  assertEquals(fatalRecord.severityText, 'FATAL')
  assertEquals(fatalRecord.severityNumber, 21)
})

Deno.test('logger: 默认输出为严格 OTel JSON 并包含基础字段', () => {
  const stdout: string[] = []
  const instant = new Date('2026-03-24T21:45:12.345Z')

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    component: 'daemon',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    now: () => instant,
    writeStdout: (line: string) => stdout.push(line),
  }).child({
    module: 'source.fetch',
    'source.run_id': 'source.rust.20260324T214512345Z',
  })

  logger.info('开始执行', {
    operation: 'fetch',
    outcome: 'success',
    'source.id': 'rust',
  })

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  const resourceAttributes = getResourceAttributes(record)

  assertEquals(record.timeUnixNano, toUnixNano(instant))
  assertEquals(record.observedTimeUnixNano, toUnixNano(instant))
  assertEquals(record.severityText, 'INFO')
  assertEquals(record.severityNumber, 9)
  assertEquals(record.body, '开始执行')
  assertEquals('trace_id' in record, false)
  assertEquals('span_id' in record, false)
  assertEquals('trace_flags' in record, false)
  assertEquals(getScopeName(record), 'source.fetch')
  assertEquals(resourceAttributes['service.name'], 'knock')
  assertEquals(resourceAttributes['deployment.environment.name'], 'dev')
  assertEquals(resourceAttributes['knock.component'], 'daemon')
  assertEquals(attributes.operation, 'fetch')
  assertEquals(attributes.outcome, 'success')
  assertEquals(attributes['source.run_id'], 'source.rust.20260324T214512345Z')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(typeof attributes['code.filepath'], 'string')
  assertStringIncludes(String(attributes['code.filepath'] ?? ''), '/src/core/logger_test.ts')
  assertEquals(typeof attributes['code.line.number'], 'number')
  assertEquals('message' in record, false)
  assertEquals('module' in record, false)
  assertEquals('level' in record, false)
})

Deno.test('logger: 应优先从调用栈补全 code.* 属性且 run_id 不冒充 trace_id', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  }).child({ 'source.run_id': 'source.rust.20260324T214512345Z' })

  function emitFromNamedFunction(): void {
    logger.info('定位栈信息', {
      operation: 'locate',
      outcome: 'success',
    })
  }

  emitFromNamedFunction()

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)

  assertEquals('trace_id' in record, false)
  assertEquals('span_id' in record, false)
  assertEquals(attributes['source.run_id'], 'source.rust.20260324T214512345Z')
  assertEquals(typeof attributes['code.filepath'], 'string')
  assertStringIncludes(String(attributes['code.filepath'] ?? ''), '/src/core/logger_test.ts')
  assertEquals(typeof attributes['code.line.number'], 'number')
  assertEquals(Number(attributes['code.line.number']) > 0, true)
  assertEquals(typeof attributes['code.function.name'], 'string')
  assertStringIncludes(String(attributes['code.function.name'] ?? ''), 'emitFromNamedFunction')
})

Deno.test('logger: 无函数名栈帧时仍输出 code.filepath 与 code.line.number', () => {
  const stdout: string[] = []
  const lineNumber = 245

  withMockedError(
    () => buildStackWithLocation({ lineNumber }),
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('无函数名栈帧', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: async 路径栈帧 fallback 时仍输出 code.filepath 与 code.line.number', () => {
  const stdout: string[] = []
  const lineNumber = 312

  withMockedError(
    () =>
      [
        'Error',
        '    at getCodeAttributes (/src/core/logger.ts:331:1)',
        `    at async ${fromFileUrl(import.meta.url)}:${lineNumber}:1`,
      ].join('\n'),
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('async 栈帧', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: ext 内部 runtime frame 应降级而不是误记为业务调用点', () => {
  const stdout: string[] = []

  withMockedError(
    () => ['Error', '    at getCodeAttributes (ext:core/01_errors.js:12:1)'].join('\n'),
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('runtime frame', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes.operation, 'locate')
  assertEquals(attributes.outcome, 'success')
  assertEquals('code.filepath' in attributes, false)
  assertEquals('code.line.number' in attributes, false)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: 归一化后的 self-frame 应被过滤并继续查找下一条业务帧', () => {
  const stdout: string[] = []
  const lineNumber = 366

  withMockedError(
    () =>
      [
        'Error',
        `    at async createLogger (${loggerModuleUrl}:420:1)`,
        `    at ${fromFileUrl(import.meta.url)}:${lineNumber}:1`,
      ].join('\n'),
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('self frame filter', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: 缓存不会把上一条调用点误复用到下一条不同 stack line', () => {
  const stdout: string[] = []
  const firstLineNumber = 401
  const secondLineNumber = 402
  let currentStack = buildStackWithLocation({ lineNumber: firstLineNumber })

  withMockedError(
    () => currentStack,
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('第一次调用点', { operation: 'locate', outcome: 'success' })
      currentStack = buildStackWithLocation({ lineNumber: secondLineNumber })
      logger.info('第二次调用点', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 2)

  const firstAttributes = getAttributes(parseRecord(stdout[0]))
  const secondAttributes = getAttributes(parseRecord(stdout[1]))

  assertEquals(firstAttributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(firstAttributes['code.line.number'], firstLineNumber)
  assertEquals(secondAttributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(secondAttributes['code.line.number'], secondLineNumber)
})

Deno.test('logger: 有界缓存 helper 达到上限时应淘汰最旧 key', () => {
  const boundedCache = new Map<string, number>()

  loggerModule.setBoundedMapEntry(boundedCache, 'first', 1, 2)
  loggerModule.setBoundedMapEntry(boundedCache, 'second', 2, 2)
  loggerModule.setBoundedMapEntry(boundedCache, 'third', 3, 2)

  assertEquals(Array.from(boundedCache.entries()), [
    ['second', 2],
    ['third', 3],
  ])

  loggerModule.setBoundedMapEntry(boundedCache, 'first', 1, 2)

  assertEquals(Array.from(boundedCache.entries()), [
    ['third', 3],
    ['first', 1],
  ])
})

Deno.test('logger: Windows 风格分隔符归一化后 self-frame 仍会被过滤', () => {
  const stdout: string[] = []
  const lineNumber = 544
  const windowsLoggerModulePath = 'C:\\repo\\src\\core\\logger.ts'

  withMockedError(
    () =>
      [
        'Error',
        `    at createLogger (${windowsLoggerModulePath}:420:1)`,
        `    at ${fromFileUrl(import.meta.url)}:${lineNumber}:1`,
      ].join('\n'),
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('windows self frame filter', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: 栈解析失败时不中断日志输出', () => {
  const stdout: string[] = []

  withMockedError(
    () => 'Error\n    at <anonymous>',
    () => {
      const logger = createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => stdout.push(line),
      })

      logger.info('栈解析失败', { operation: 'locate', outcome: 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes.operation, 'locate')
  assertEquals(attributes.outcome, 'success')
  assertEquals('code.filepath' in attributes, false)
  assertEquals('code.line.number' in attributes, false)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('logger: format=pretty 时应通过 @logtape/pretty 渲染并保持脱敏', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'info',
    format: 'pretty',
    module: 'delivery.http',
    timezone: 'Asia/Shanghai',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('推送完成', {
    operation: 'push',
    outcome: 'success',
    sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
    token: '123456:ABCDEF-SECRET',
  })
  logger.info('再次推送完成', {
    operation: 'push',
    outcome: 'success',
    sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
    token: '123456:ABCDEF-SECRET',
  })

  assertEquals(stdout.length, 2)
  assertStringIncludes(stdout[0], '2026-03-25 05:45:12')
  assertStringIncludes(stdout[0], 'knock·delivery.http')
  assertStringIncludes(stdout[0], '推送完成')
  assertEquals(stdout[0].includes('123456:ABCDEF-SECRET'), false)
  assertEquals(stdout[0].includes('user:pass@'), false)
  assertStringIncludes(stdout[1], '2026-03-25 05:45:12')
  assertStringIncludes(stdout[1], 'knock·delivery.http')
  assertStringIncludes(stdout[1], '再次推送完成')
  assertEquals(stdout[1].includes('123456:ABCDEF-SECRET'), false)
  assertEquals(stdout[1].includes('user:pass@'), false)
})

Deno.test('logger: module 只有一个事实源并写入 scope.name，业务字段进入 attributes', () => {
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
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(getScopeName(record), 'source.parse.rss')
  assertEquals(attributes.item_count, 2)
  assertEquals('itemCount' in attributes, false)
  assertEquals('module' in record, false)
})

Deno.test('logger: child 应保留 resource 并把 HTTP 语义字段写入标准 attributes', () => {
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
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  const resourceAttributes = getResourceAttributes(record)

  assertEquals(getScopeName(record), 'web.api.xquery.evaluate')
  assertEquals(record.body, 'API 请求开始')
  assertEquals(resourceAttributes['knock.component'], 'web')
  assertEquals(attributes.operation, 'request')
  assertEquals(attributes.outcome, 'start')
  assertEquals(attributes['http.request.method'], 'POST')
  assertEquals(attributes['http.route'], '/api/xquery/evaluate')
})

Deno.test('logger: null 字段应直接省略而不是序列化为空字符串', () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('省略缺失字段', {
    'config.path': null,
    'delivery.reason': undefined,
    'source.id': 'rust',
  })

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)

  assertEquals('config.path' in attributes, false)
  assertEquals('delivery.reason' in attributes, false)
  assertEquals(attributes['source.id'], 'rust')
})

Deno.test('logger: nested object 内部的 null 与 undefined 字段应被省略', () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('省略嵌套对象缺失字段', {
    'config.snapshot': {
      sourceId: 'rust',
      optionalNull: null,
      optionalUndefined: undefined,
      nested: {
        keep: 'ok',
        dropNull: null,
        dropUndefined: undefined,
      },
    },
  })

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  const snapshot = attributes['config.snapshot'] as Record<string, unknown>
  const nested = snapshot.nested as Record<string, unknown>

  assertEquals(snapshot.source_id, 'rust')
  assertEquals('optional_null' in snapshot, false)
  assertEquals('optional_undefined' in snapshot, false)
  assertEquals(nested.keep, 'ok')
  assertEquals('drop_null' in nested, false)
  assertEquals('drop_undefined' in nested, false)
})

Deno.test('logger: array 元素应保留旧标量语义', () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('数组标量旧语义', {
    'pipeline.values': [null, undefined, '  rust  ', 1],
  })

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)

  assertEquals(attributes['pipeline.values'], ['', null, 'rust', 1])
})

Deno.test('logger: 敏感字段与敏感内容应在 OTel attributes 中继续脱敏', () => {
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
    'delivery.id': 'rust__webhook__0',
    url: 'https://api.telegram.org/bot123456:ABCDEF-SECRET/sendMessage?token=abc',
    body: '{"ok":false,"description":"bad token"}',
    errorMessage: 'telegram failed: token=123456:ABCDEF-SECRET chat_id=987654321 body={"ok":false}',
    stack:
      'Error: telegram failed https://api.telegram.org/bot123456:ABCDEF-SECRET/sendMessage?token=abc',
    content: 'hello secret',
  })

  assertEquals(stderr.length, 1)
  const record = parseRecord(stderr[0])
  const attributes = getAttributes(record)
  assertEquals(record.body, '发送失败')
  assertEquals(attributes.token, '****')
  assertEquals(attributes.chat_id, '****')
  assertEquals(attributes.content, '****')
  assertEquals(attributes.body, '****')
  assertEquals(attributes.url, 'https://api.telegram.org/bot****/sendMessage')
  assertEquals(attributes.source_url, 'https://example.com/feed.xml')
  assertEquals(attributes['delivery.id'], 'rust__webhook__0')
  assertEquals(
    attributes['exception.message'],
    'telegram failed: token=**** chat_id=**** body=****',
  )
  assertEquals(
    attributes['exception.stacktrace'],
    'Error: telegram failed https://api.telegram.org/bot****/sendMessage?token=****',
  )
})
