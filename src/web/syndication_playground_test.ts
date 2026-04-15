import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  classifySyndicationPlaygroundError,
  evaluateSyndicationPlayground,
  parseSyndicationPlaygroundRequest,
} from './syndication_playground.ts'

Deno.test('[contract] syndication_playground: 空 mapping 时应保留 runtime 默认行为', () => {
  const parsed = parseSyndicationPlaygroundRequest({
    runtime: 'native',
    url: 'https://example.com/feed.xml',
    feed: {},
    entry: {},
  })

  assertEquals(parsed.source.http?.url, 'https://example.com/feed.xml')
  assertEquals(parsed.source.deliveries, {})
  assertEquals(parsed.source.syndication, {})
})

Deno.test('[contract] syndication_playground: byparr 模式请求应转换为 byparr source', () => {
  const parsed = parseSyndicationPlaygroundRequest({
    runtime: 'byparr',
    url: 'https://example.com/feed.xml',
    entry: { id: '{{ id }}' },
  })

  assertEquals(parsed.source.byparr?.url, 'https://example.com/feed.xml')
  assertEquals(parsed.source.http, undefined)
  assertEquals(parsed.source.syndication?.entry, { id: '{{ id }}' })
})

Deno.test(
  '[flow] syndication_playground: 应将解析后的 request 委托给 preview runtime 并透传 rawContent',
  async () => {
    const result = await evaluateSyndicationPlayground({
      request: {
        url: 'https://example.com/feed.xml',
        feed: { title: '{{ title }}' },
        entry: { id: '{{ id }}', content: '{{ content }}' },
      },
      previewExecutor: ({ source }) => {
        assertEquals(source.http?.url, 'https://example.com/feed.xml')
        assertEquals(source.syndication?.feed, { title: '{{ title }}' })
        assertEquals(source.syndication?.entry, { id: '{{ id }}', content: '{{ content }}' })
        return Promise.resolve({
          warnings: [],
          fetchMeta: { ok: true, payloadBytes: 11, fetchDurationMs: 12, parseDurationMs: 5 },
          parser: 'rss',
          rawContent: '<rss></rss>',
          feed: { title: 'Feed' },
          entries: [{ mapped: { id: '1', content: 'Body' } }],
        })
      },
    })

    assertEquals(result.parser, 'rss')
    assertEquals(result.rawContent, '<rss></rss>')
    assertEquals(result.feed, { title: 'Feed' })
    assertEquals(result.entries, [{ mapped: { id: '1', content: 'Body' } }])
    assertEquals(result.fetchMeta.ok, true)
  },
)

Deno.test(
  '[contract] syndication_playground: 默认 logging shape 应与正式 resolved config 一致',
  async () => {
    const result = await evaluateSyndicationPlayground({
      request: {
        url: 'https://example.com/feed.xml',
        entry: { id: '{{ id }}' },
      },
      previewExecutor: ((input: unknown) => {
        const { config, source } = input as {
          config?: {
            logging: { level: string; format: string; sinks: { console?: { type: string } } }
          }
          source: { http?: { url?: string } }
        }

        assertEquals(source.http?.url, 'https://example.com/feed.xml')
        assertEquals(config?.logging.level, 'info')
        assertEquals(config?.logging.format, 'json')
        assertEquals(config?.logging.sinks.console?.type, 'console')
        return Promise.resolve({
          warnings: [],
          fetchMeta: { ok: true },
          parser: 'rss',
          rawContent: '<rss></rss>',
          feed: {},
          entries: [],
        })
      }) as never,
    })

    assertEquals(result.parser, 'rss')
  },
)

Deno.test('[contract] syndication_playground: 应拒绝 localhost 地址', () => {
  assertThrows(
    () =>
      parseSyndicationPlaygroundRequest({
        url: 'http://localhost:8080/private',
        entry: { id: '{{ id }}' },
      }),
    Error,
    'Playground 不允许访问内网或本机地址',
  )
})

Deno.test('[contract] syndication_playground: classify 应将抓取失败映射为 fetch', () => {
  const classified = classifySyndicationPlaygroundError(
    new Error('[source] 抓取失败 source=playground status=404'),
  )

  assertEquals(classified.status, 502)
  assertEquals(classified.code, 'playground_fetch_failed')
  assertEquals(classified.category, 'fetch')
  assertEquals(classified.message, '抓取失败: HTTP 404')
})

Deno.test(
  '[contract] syndication_playground: evaluate 遇到非 2xx 响应时应保留底层抓取错误',
  async () => {
    await assertRejects(
      () =>
        evaluateSyndicationPlayground({
          request: {
            url: 'https://example.com/feed.xml',
            entry: { id: '{{ id }}' },
          },
          fetcher: () => Promise.resolve(new Response('not found', { status: 404 })),
        }),
      Error,
      '[source] 抓取失败 source=playground status=404',
    )
  },
)
