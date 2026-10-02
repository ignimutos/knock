import { assertEquals, assertRejects } from '../../testing/assert.ts'
import { createLogger } from '../../core/logger.ts'
import { SourceParserGateway } from './source_parser_gateway.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R14
// layer: contract

function parseLogs(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

function findParseLog(
  logs: Array<Record<string, unknown>>,
  outcome: 'success' | 'failure',
): Record<string, unknown> | undefined {
  return logs.find((item) => {
    const scope = (item.scope ?? {}) as Record<string, unknown>
    const attributes = (item.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'source.parse' &&
      attributes['source.operation'] === 'parse_payload' &&
      attributes['source.outcome'] === outcome
    )
  })
}

test('[contract] sourceParserGateway: 应以 RunPlan.source.parser 为准，不得静默回落到其他 parser', async () => {
  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: {
        url: 'https://example.com/feed.xml',
      },
      syndication: {
        feed: {},
        entry: {},
      },
      deliveries: [],
    }),
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
  })

  await assertRejects(() =>
    gateway.parse(
      {
        runId: 'run-1',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'xquery',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      },
      {
        kind: 'fetch',
        collectedAt: '2026-04-13T10:00:00.000Z',
        rawText: '<rss version="2.0"><channel><title>Rust</title></channel></rss>',
        payloadSummary: { hash: 'hash-1' },
      },
    ),
  )
})

test('[flow] R14 sourceParserGateway: xquery 结果应归一化为统一 feed/item 字段', async () => {
  const logs: string[] = []
  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: {
        url: 'https://example.com/page.html',
      },
      xquery: {
        feed: {
          title: "'Feed Title'",
        },
        entry: {
          id: "'entry-1'",
          title: "'Entry Title'",
        },
      },
      deliveries: [],
    }),
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'source.parse',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  const parsed = await gateway.parse(
    {
      runId: 'run-2',
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'xquery',
      },
      profile: 'production',
      effectDomain: 'production',
      trigger: 'scheduled',
      scheduledAt: '2026-04-13T10:00:00.000Z',
      bindings: [],
    },
    {
      kind: 'fetch',
      collectedAt: '2026-04-13T10:00:00.000Z',
      rawText: '<html><body><article></article></body></html>',
      payloadSummary: { hash: 'hash-2' },
    },
  )

  assertEquals(parsed.feed.title, 'Feed Title')
  assertEquals(parsed.feed.link, '')
  assertEquals(parsed.feed.description, '')
  assertEquals(parsed.feed.generator, '')
  assertEquals(parsed.feed.language, '')
  assertEquals(parsed.feed.published, '')

  assertEquals(parsed.items[0]?.id, 'entry-1')
  assertEquals(parsed.items[0]?.title, 'Entry Title')
  assertEquals(parsed.items[0]?.link, '')
  assertEquals(parsed.items[0]?.description, '')
  assertEquals(parsed.items[0]?.content, '')
  assertEquals(parsed.items[0]?.published, '')
  assertEquals(parsed.items[0]?.updated, '')

  const record = findParseLog(parseLogs(logs), 'success')
  const attributes = (record?.attributes ?? {}) as Record<string, unknown>
  assertEquals(Boolean(record), true)
  assertEquals(attributes['source.operation'], 'parse_payload')
  assertEquals(attributes['source.outcome'], 'success')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(attributes['source.parser'], 'xquery')
  assertEquals(attributes['source.item_count'], 1)
})

test('[contract] sourceParserGateway: 解析失败应记录失败日志与标准错误字段', async () => {
  const logs: string[] = []
  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: {
        url: 'https://example.com/page.html',
      },
      syndication: {
        feed: {},
        entry: {},
      },
      deliveries: [],
    }),
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'source.parse',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  await assertRejects(() =>
    gateway.parse(
      {
        runId: 'run-3',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      },
      {
        kind: 'fetch',
        collectedAt: '2026-04-13T10:00:00.000Z',
        rawText: '<rss>',
        payloadSummary: { hash: 'hash-3' },
      },
    ),
  )

  const record = findParseLog(parseLogs(logs), 'failure')
  const attributes = (record?.attributes ?? {}) as Record<string, unknown>
  assertEquals(Boolean(record), true)
  assertEquals(attributes['source.operation'], 'parse_payload')
  assertEquals(attributes['source.outcome'], 'failure')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(typeof attributes['exception.type'], 'string')
  assertEquals(typeof attributes['exception.message'], 'string')
})

test('[contract] sourceParserGateway: 解析失败日志应使用稳定错误消息且不泄漏输入片段', async () => {
  const logs: string[] = []
  const leakedFragment = 'SECRET_SOURCE_PAYLOAD_FRAGMENT'
  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'daily',
      enabled: true,
      name: 'Daily',
      summary: {
        sources: ['rust'],
      },
      deliveries: [],
    }),
    readModel: {
      getSummaryCheckpoint: () => Promise.resolve('2026-04-13T09:00:00.000Z'),
      getSummaryInputs: () => {
        throw new Error(`summary parse failed: ${leakedFragment}`)
      },
    },
    contentRuntime: {
      renderContent: (template: string) => Promise.resolve(template),
      buildContext: () => ({}),
      shouldPassFilter: () => true,
      renderPayload: () => Promise.resolve(''),
    } as unknown as import('../../core/content_runtime.ts').ContentRuntime,
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'source.parse',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  await assertRejects(() =>
    gateway.parse(
      {
        runId: 'run-5',
        source: {
          kind: 'summary',
          sourceId: 'daily',
          upstreamSourceIds: ['rust'],
        },
        profile: 'preview',
        effectDomain: 'preview',
        trigger: 'preview',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      },
      {
        kind: 'summary',
        collectedAt: '2026-04-13T10:00:00.000Z',
        payloadSummary: { hash: 'hash-summary-fail' },
        collectedJson: {},
      },
    ),
  )

  const record = findParseLog(parseLogs(logs), 'failure')
  const attributes = (record?.attributes ?? {}) as Record<string, unknown>
  assertEquals(Boolean(record), true)
  assertEquals(attributes['source.operation'], 'parse_payload')
  assertEquals(attributes['source.outcome'], 'failure')
  assertEquals(attributes['source.id'], 'daily')
  assertEquals(typeof attributes['exception.type'], 'string')
  assertEquals(attributes['exception.message'], 'source parser failed')
  assertEquals(JSON.stringify(record).includes(leakedFragment), false)
})

test('[contract] sourceParserGateway: xquery 字符串 map 结果中的额外键应被裁掉', async () => {
  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: {
        url: 'https://example.com/page.html',
      },
      xquery: {
        feed: "map { 'title': 'Feed Title', 'extra': 'leak' }",
        entry: "map { 'id': 'entry-1', 'title': 'Entry Title', 'extra': 'leak' }",
      },
      deliveries: [],
    }),
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
  })

  const parsed = await gateway.parse(
    {
      runId: 'run-4',
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'xquery',
      },
      profile: 'production',
      effectDomain: 'production',
      trigger: 'scheduled',
      scheduledAt: '2026-04-13T10:00:00.000Z',
      bindings: [],
    },
    {
      kind: 'fetch',
      collectedAt: '2026-04-13T10:00:00.000Z',
      rawText: '<html><body><article></article></body></html>',
      payloadSummary: { hash: 'hash-4' },
    },
  )

  assertEquals('extra' in parsed.feed, false)
  assertEquals('extra' in parsed.items[0]!, false)
})

test('[contract] sourceParserGateway: summary 上游列表应以 RunPlan.source.upstreamSourceIds 为准', async () => {
  let seenSourceIds: string[] | undefined

  const gateway = new SourceParserGateway({
    resolveSourceConfig: () => ({
      id: 'daily',
      enabled: true,
      name: 'Daily',
      summary: {
        sources: ['wrong-source'],
      },
      deliveries: [],
    }),
    readModel: {
      getSummaryCheckpoint: () => Promise.resolve('2026-04-13T09:00:00.000Z'),
      getSummaryInputs: (sourceIds) => {
        seenSourceIds = sourceIds
        return Promise.resolve({
          rust: { name: 'Rust', feed: {}, entries: [] },
          bun: { name: 'Bun', feed: {}, entries: [] },
        })
      },
    },
    contentRuntime: {
      renderContent: (template: string) => Promise.resolve(template),
      buildContext: () => ({}),
      shouldPassFilter: () => true,
      renderPayload: () => Promise.resolve(''),
    } as unknown as import('../../core/content_runtime.ts').ContentRuntime,
    timeOptions: {
      timezone: 'UTC',
      timestampFormat: 'iso',
    },
    language: 'en-US',
  })

  await gateway.parse(
    {
      runId: 'run-summary',
      source: {
        kind: 'summary',
        sourceId: 'daily',
        upstreamSourceIds: ['rust', 'bun'],
      },
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      scheduledAt: '2026-04-13T10:00:00.000Z',
      bindings: [],
    },
    {
      kind: 'summary',
      collectedAt: '2026-04-13T10:00:00.000Z',
      payloadSummary: { hash: 'hash-summary' },
      collectedJson: {},
    },
  )

  assertEquals(seenSourceIds, ['rust', 'bun'])
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R14'],
  },
  {
    title: '[flow] R14 sourceParserGateway: xquery 结果应归一化为统一 feed/item 字段',
    layer: 'flow',
    risks: ['R14'],
  },
] as const
