import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl } from '@std/path'
import * as loggerModule from './logger.ts'
import { configureLoggingRuntime, shutdownLoggingRuntime } from './logging_runtime.ts'

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

Deno.test('[contract] R11 logger: console format=jsonl 应输出仓库 OTel JSONL', async () => {
  const stdout: string[] = []

  await configureLoggingRuntime({
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
    },
  })

  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.http',
  })
  logger.info('推送完成', { 'delivery.id': 'telegram' })
  await shutdownLoggingRuntime()

  const record = parseRecord(stdout.at(-1) ?? '')
  assertEquals(record.severityText, 'INFO')
  assertEquals(getScopeName(record), 'delivery.http')
  assertEquals(getAttributes(record)['delivery.id'], 'telegram')
})

Deno.test('[contract] R11 logger: runtime pretty 应输出高密度单行并隐藏块状字段', async () => {
  const stdout: string[] = []

  await configureLoggingRuntime({
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'pretty',
        },
      },
    },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
    },
  })

  createLogger({
    enabled: true,
    level: 'info',
    module: 'pipeline.filter',
    component: 'daemon',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
  }).info('pipeline item filtered', {
    'source.id': 'smzdm',
    'source.run_id': 'a81ce6e0-4906-485b-a41d-3bf3075af785',
  })
  await shutdownLoggingRuntime()

  const line = stdout.at(-1) ?? ''
  assertStringIncludes(line, '2026-03-24 21:45:12')
  assertStringIncludes(line, 'info')
  assertStringIncludes(line, 'filter')
  assertStringIncludes(line, 'component=daemon')
  assertStringIncludes(line, 'source.id=smzdm')
  assertEquals(line.includes('resource:'), false)
  assertEquals(line.includes('attributes:'), false)
})

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

Deno.test('[contract] R11 logger: enabled=false 时不输出日志', () => {
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

  logger.info('启动完成', { 'app.operation': 'boot', 'app.outcome': 'success' })
  logger.error('启动失败', { 'app.operation': 'boot', 'app.outcome': 'failure' })

  assertEquals(stdout.length, 0)
  assertEquals(stderr.length, 0)
})

Deno.test('[contract] R11 logger: level=warn 时过滤 info 但保留 warn/error/fatal', () => {
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

  logger.info('启动完成', { 'app.operation': 'boot', 'app.outcome': 'success' })
  logger.warn('重入跳过', {
    'scheduler.operation': 'run_source',
    'scheduler.outcome': 'skipped',
    'scheduler.reason': 'reentry_inflight',
  })
  logger.error('启动失败', { 'app.operation': 'boot', 'app.outcome': 'failure' })
  logger.fatal('进程无法继续', { 'app.operation': 'boot', 'app.outcome': 'fatal_failure' })

  assertEquals(stdout.length, 1)
  assertEquals(stderr.length, 2)

  const warnRecord = parseRecord(stdout[0])
  const warnAttributes = getAttributes(warnRecord)
  const errorRecord = parseRecord(stderr[0])
  const errorAttributes = getAttributes(errorRecord)
  const fatalRecord = parseRecord(stderr[1])
  const fatalAttributes = getAttributes(fatalRecord)
  assertEquals(warnRecord.severityText, 'WARN')
  assertEquals(warnRecord.severityNumber, 13)
  assertEquals(warnAttributes['scheduler.operation'], 'run_source')
  assertEquals(warnAttributes['scheduler.outcome'], 'skipped')
  assertEquals(warnAttributes['scheduler.reason'], 'reentry_inflight')
  assertEquals('operation' in warnAttributes, false)
  assertEquals('outcome' in warnAttributes, false)
  assertEquals(errorRecord.severityText, 'ERROR')
  assertEquals(errorRecord.severityNumber, 17)
  assertEquals(errorAttributes['app.operation'], 'boot')
  assertEquals(errorAttributes['app.outcome'], 'failure')
  assertEquals('operation' in errorAttributes, false)
  assertEquals('outcome' in errorAttributes, false)
  assertEquals(fatalRecord.severityText, 'FATAL')
  assertEquals(fatalRecord.severityNumber, 21)
  assertEquals(fatalAttributes['app.operation'], 'boot')
  assertEquals(fatalAttributes['app.outcome'], 'fatal_failure')
  assertEquals('operation' in fatalAttributes, false)
  assertEquals('outcome' in fatalAttributes, false)
})

Deno.test('[contract] R11 logger: 默认输出为严格 OTel JSON 并包含基础字段', () => {
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
    'source.operation': 'fetch',
    'source.outcome': 'success',
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
  assertEquals(attributes['source.operation'], 'fetch')
  assertEquals(attributes['source.outcome'], 'success')
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
  assertEquals(attributes['source.run_id'], 'source.rust.20260324T214512345Z')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(typeof attributes['code.filepath'], 'string')
  assertStringIncludes(String(attributes['code.filepath'] ?? ''), '/src/core/logger_test.ts')
  assertEquals(typeof attributes['code.line.number'], 'number')
  assertEquals('message' in record, false)
  assertEquals('module' in record, false)
  assertEquals('level' in record, false)
})

Deno.test('[contract] R11 logger: 应优先从调用栈补全 code.* 属性且 run_id 不冒充 trace_id', () => {
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
      'app.operation': 'locate',
      'app.outcome': 'success',
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
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
})

Deno.test('[contract] R11 logger: 无函数名栈帧时仍输出 code.filepath 与 code.line.number', () => {
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

      logger.info('无函数名栈帧', { 'app.operation': 'locate', 'app.outcome': 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
})

Deno.test(
  '[contract] R11 logger: async 路径栈帧 fallback 时仍输出 code.filepath 与 code.line.number',
  () => {
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

        logger.info('async 栈帧', { 'app.operation': 'locate', 'app.outcome': 'success' })
      },
    )

    assertEquals(stdout.length, 1)
    const record = parseRecord(stdout[0])
    const attributes = getAttributes(record)
    assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
    assertEquals(attributes['code.line.number'], lineNumber)
    assertEquals('code.function.name' in attributes, false)
    assertEquals('operation' in attributes, false)
    assertEquals('outcome' in attributes, false)
  },
)

Deno.test('[contract] R11 logger: ext 内部 runtime frame 应降级而不是误记为业务调用点', () => {
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

      logger.info('runtime frame', { 'app.operation': 'locate', 'app.outcome': 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['app.operation'], 'locate')
  assertEquals(attributes['app.outcome'], 'success')
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
  assertEquals('code.filepath' in attributes, false)
  assertEquals('code.line.number' in attributes, false)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('[contract] R11 logger: 归一化后的 self-frame 应被过滤并继续查找下一条业务帧', () => {
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

      logger.info('self frame filter', { 'app.operation': 'locate', 'app.outcome': 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
})

Deno.test('[contract] R11 logger: 缓存不会把上一条调用点误复用到下一条不同 stack line', () => {
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

      logger.info('第一次调用点', { 'app.operation': 'locate', 'app.outcome': 'success' })
      currentStack = buildStackWithLocation({ lineNumber: secondLineNumber })
      logger.info('第二次调用点', { 'app.operation': 'locate', 'app.outcome': 'success' })
    },
  )

  assertEquals(stdout.length, 2)

  const firstAttributes = getAttributes(parseRecord(stdout[0]))
  const secondAttributes = getAttributes(parseRecord(stdout[1]))

  assertEquals(firstAttributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(firstAttributes['code.line.number'], firstLineNumber)
  assertEquals(secondAttributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(secondAttributes['code.line.number'], secondLineNumber)
  assertEquals('operation' in firstAttributes, false)
  assertEquals('outcome' in firstAttributes, false)
  assertEquals('operation' in secondAttributes, false)
  assertEquals('outcome' in secondAttributes, false)
})

Deno.test('[contract] R11 logger: 有界缓存 helper 达到上限时应淘汰最旧 key', () => {
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

Deno.test('[contract] R11 logger: Windows 风格分隔符归一化后 self-frame 仍会被过滤', () => {
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

      logger.info('windows self frame filter', {
        'app.operation': 'locate',
        'app.outcome': 'success',
      })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['code.filepath'], fromFileUrl(import.meta.url))
  assertEquals(attributes['code.line.number'], lineNumber)
  assertEquals('code.function.name' in attributes, false)
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
})

Deno.test('[contract] R11 logger: 栈解析失败时不中断日志输出', () => {
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

      logger.info('栈解析失败', { 'app.operation': 'locate', 'app.outcome': 'success' })
    },
  )

  assertEquals(stdout.length, 1)
  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)
  assertEquals(attributes['app.operation'], 'locate')
  assertEquals(attributes['app.outcome'], 'success')
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
  assertEquals('code.filepath' in attributes, false)
  assertEquals('code.line.number' in attributes, false)
  assertEquals('code.function.name' in attributes, false)
})

Deno.test('[contract] R11 logger: format=pretty 时应通过 @logtape/pretty 渲染并保持脱敏', () => {
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
    'delivery.operation': 'push',
    'delivery.outcome': 'success',
    sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
    token: '123456:ABCDEF-SECRET',
  })
  logger.info('再次推送完成', {
    'delivery.operation': 'push',
    'delivery.outcome': 'success',
    sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
    token: '123456:ABCDEF-SECRET',
  })

  assertEquals(stdout.length, 2)
  assertStringIncludes(stdout[0], '2026-03-25 05:45:12')
  assertStringIncludes(stdout[0], 'http')
  assertStringIncludes(stdout[0], '推送完成')
  assertEquals(stdout[0].includes('123456:ABCDEF-SECRET'), false)
  assertEquals(stdout[0].includes('user:pass@'), false)
  assertStringIncludes(stdout[1], '2026-03-25 05:45:12')
  assertStringIncludes(stdout[1], 'http')
  assertStringIncludes(stdout[1], '再次推送完成')
  assertEquals(stdout[1].includes('123456:ABCDEF-SECRET'), false)
  assertEquals(stdout[1].includes('user:pass@'), false)
})

Deno.test(
  '[contract] R11 logger: pretty info 应隐藏低价值调试字段，只保留最小字段集与关键信息',
  () => {
    const stdout: string[] = []

    const logger = createLogger({
      enabled: true,
      level: 'info',
      format: 'pretty',
      module: 'web.api',
      component: 'web',
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => stdout.push(line),
    })

    logger.info('API 请求完成', {
      route: '/api/xquery/evaluate',
      method: 'POST',
      'web.request_id': 'web.req.1',
      'web.duration_ms': 18,
      'http.response.status_code': 200,
      'pipeline.warning_count': 2,
    })

    assertEquals(stdout.length, 1)
    assertStringIncludes(stdout[0], '2026-03-24 21:45:12')
    assertStringIncludes(stdout[0], 'api')
    assertStringIncludes(stdout[0], 'API 请求完成')
    assertStringIncludes(stdout[0], 'web.req.1')
    assertStringIncludes(stdout[0], '/api/xquery/evaluate')
    assertEquals(stdout[0].includes('code.filepath'), false)
    assertEquals(stdout[0].includes('pipeline.warning_count'), false)
  },
)

Deno.test('[contract] R11 logger: pretty debug 应保留真实诊断字段', () => {
  const stdout: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'debug',
    format: 'pretty',
    module: 'web.api',
    component: 'web',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.debug('API 请求开始', {
    route: '/api/xquery/evaluate',
    method: 'POST',
    'web.request_id': 'web.req.2',
    'pipeline.warning_count': 2,
  })

  assertEquals(stdout.length, 1)
  assertStringIncludes(stdout[0], 'API 请求开始')
  assertStringIncludes(stdout[0], 'pipeline.warning_count')
  assertStringIncludes(stdout[0], '/src/core/logger_test.ts')
})

Deno.test(
  '[contract] R11 logger: module 只有一个事实源并写入 scope.name，业务字段进入 attributes',
  () => {
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
      'source.operation': 'parse',
      'source.outcome': 'success',
      itemCount: 2,
    })

    assertEquals(stdout.length, 1)
    const record = parseRecord(stdout[0])
    const attributes = getAttributes(record)
    assertEquals(getScopeName(record), 'source.parse.rss')
    assertEquals(attributes['source.operation'], 'parse')
    assertEquals(attributes['source.outcome'], 'success')
    assertEquals('operation' in attributes, false)
    assertEquals('outcome' in attributes, false)
    assertEquals(attributes.item_count, 2)
    assertEquals('itemCount' in attributes, false)
    assertEquals('module' in record, false)
  },
)

Deno.test(
  '[contract] R11 logger: child 应保留 resource 并把 HTTP 语义字段写入标准 attributes',
  () => {
    const stdout: string[] = []

    const logger = createLogger({
      enabled: true,
      level: 'info',
      module: 'app.startup',
      component: 'web',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => stdout.push(line),
    }).child({ module: 'web.api.xquery.evaluate', route: '/api/xquery/evaluate' })

    logger.info('API 请求开始', {
      'web.operation': 'request',
      'web.outcome': 'start',
      method: 'POST',
    })

    assertEquals(stdout.length, 1)
    const record = parseRecord(stdout[0])
    const attributes = getAttributes(record)
    const resourceAttributes = getResourceAttributes(record)

    assertEquals(getScopeName(record), 'web.api.xquery.evaluate')
    assertEquals(record.body, 'API 请求开始')
    assertEquals(resourceAttributes['knock.component'], 'web')
    assertEquals(attributes['web.operation'], 'request')
    assertEquals(attributes['web.outcome'], 'start')
    assertEquals('operation' in attributes, false)
    assertEquals('outcome' in attributes, false)
    assertEquals(attributes['http.request.method'], 'POST')
    assertEquals(attributes['http.route'], '/api/xquery/evaluate')
  },
)

Deno.test('[contract] R11 logger: null 字段应直接省略而不是序列化为空字符串', () => {
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

Deno.test('[contract] R11 logger: nested object 内部的 null 与 undefined 字段应被省略', () => {
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

Deno.test('[contract] R11 logger: array 元素应保留旧标量语义', () => {
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

Deno.test('[contract] R11 logger: 敏感字段与敏感内容应在 OTel attributes 中继续脱敏', () => {
  const stderr: string[] = []

  const logger = createLogger({
    enabled: true,
    level: 'error',
    module: 'delivery.http',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStderr: (line: string) => stderr.push(line),
  })

  logger.error('发送失败', {
    'delivery.operation': 'send_message',
    'delivery.outcome': 'failure',
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
  assertEquals(attributes['delivery.operation'], 'send_message')
  assertEquals(attributes['delivery.outcome'], 'failure')
  assertEquals('operation' in attributes, false)
  assertEquals('outcome' in attributes, false)
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
