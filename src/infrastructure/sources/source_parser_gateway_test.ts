import { assertEquals, assertRejects } from '@std/assert'
import { SourceParserGateway } from './source_parser_gateway.ts'

// risk-id: R14
// layer: contract

Deno.test(
  '[contract] sourceParserGateway: 应以 RunPlan.source.parser 为准，不得静默回落到其他 parser',
  async () => {
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
  },
)

Deno.test('[flow] R14 sourceParserGateway: xquery 结果应归一化为统一 feed/item 字段', async () => {
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
})

Deno.test('[contract] sourceParserGateway: xquery 字符串 map 结果中的额外键应被裁掉', async () => {
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
      runId: 'run-3',
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
      payloadSummary: { hash: 'hash-3' },
    },
  )

  assertEquals('extra' in parsed.feed, false)
  assertEquals('extra' in parsed.items[0]!, false)
})

Deno.test(
  '[contract] sourceParserGateway: summary 上游列表应以 RunPlan.source.upstreamSourceIds 为准',
  async () => {
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
      summaryQueryService: {
        getSummaryCheckpoint: () => Promise.resolve('2026-04-13T09:00:00.000Z'),
        getSummaryInputs: (sourceIds) => {
          seenSourceIds = sourceIds
          return Promise.resolve({
            rust: { name: 'Rust', feed: {}, entries: [] },
            deno: { name: 'Deno', feed: {}, entries: [] },
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
          upstreamSourceIds: ['rust', 'deno'],
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

    assertEquals(seenSourceIds, ['rust', 'deno'])
  },
)
