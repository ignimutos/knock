import { assertEquals, assertRejects } from '@std/assert'
import type { ResolvedSourceConfig } from '../config/types.ts'
import { createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createHttpClient } from '../core/http_client.ts'
import { createLogger } from '../core/logger.ts'
import { fetchAndParseSource } from './source_runtime.ts'

function createTestAiRuntime(
  generateText: (input: Record<string, unknown>) => Promise<{ text: string }>,
) {
  return createAiRuntime({
    ai: {
      providers: [
        {
          id: 'openai_main',
          type: 'openai',
          apiKey: 'test-key',
          models: [
            {
              id: 'default',
              providerId: 'openai_main',
              providerType: 'openai',
              ref: 'openai_main/default',
              model: 'gpt-4o-mini',
              context: 8192,
              maxOutputTokens: 400,
              variants: {},
            },
          ],
        },
      ],
      defaultModel: {
        ref: 'openai_main/default',
        providerId: 'openai_main',
        modelId: 'default',
      },
      modelRefs: {
        'openai_main/default': {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
      },
    },
    defaultLanguage: 'zh-CN',
    generateText: (input) => generateText(input as unknown as Record<string, unknown>),
  })
}

function getRequestClient(init: RequestInit | undefined): Deno.HttpClient | undefined {
  return (init as (RequestInit & { client?: Deno.HttpClient }) | undefined)?.client
}

function getRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  if (input instanceof Request) return input.headers
  return new Headers(init?.headers)
}

function createSyndicationSource(http: ResolvedSourceConfig['http']): ResolvedSourceConfig {
  return {
    id: 's1',
    enabled: true,
    deliveries: [],
    http,
    syndication: {},
  }
}

const MINIMAL_RSS_PAYLOAD = '<rss><channel><title>Feed</title></channel></rss>'

function createTestLogger(records: Array<Record<string, unknown>>) {
  const write = (line: string) => {
    records.push(JSON.parse(line) as Record<string, unknown>)
  }

  return createLogger({
    enabled: true,
    level: 'info',
    module: 'test',
    now: () => new Date('2026-04-11T08:00:00.000Z'),
    writeStdout: write,
    writeWarn: write,
    writeStderr: write,
  })
}

Deno.test('source_runtime: syndication source 应完成抓取与解析', async () => {
  const parsed = await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
    }),
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response(`
<rss>
  <channel>
    <title>Feed</title>
    <item>
      <guid>id-1</guid>
      <title>Hello</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`),
        ),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.payload.includes('<rss>'), true)
  assertEquals(parsed.parser, 'rss')
  assertEquals(parsed.feedMapped.title, 'Feed')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, 'id-1')
})

Deno.test('source_runtime: xquery source 应完成抓取与解析', async () => {
  const parsed = await fetchAndParseSource({
    source: {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/page.html',
      },
      xquery: {
        locate: '//li',
        feed: {
          title: 'string(//a)',
        },
        entry: {
          id: 'string(@data-id)',
          title: 'string(a)',
        },
      },
    },
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response('<html><body><ul><li data-id="1"><a>Hello</a></li></ul></body></html>'),
        ),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.parser, 'xquery')
  assertEquals(parsed.feedMapped.title, 'Hello')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
})

Deno.test('source_runtime: xquery 脚本模式应完成抓取与解析', async () => {
  const parsed = await fetchAndParseSource({
    source: {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/page.html',
      },
      xquery: {
        locate: '//li',
        feed: `map {
          "title": string(//h1)
        }`,
        entry: `map {
          "id": string(@data-id),
          "title": string(a)
        }`,
      },
    },
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response(
            '<html><body><h1>Feed</h1><ul><li data-id="1"><a>Hello</a></li></ul></body></html>',
          ),
        ),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.parser, 'xquery')
  assertEquals(parsed.feedMapped.title, 'Feed')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
})

Deno.test('source_runtime: summary source 缺少 summary 依赖时应拒绝执行', async () => {
  await assertRejects(
    () =>
      fetchAndParseSource({
        source: {
          id: 'summary.daily',
          name: 'Daily Summary',
          enabled: true,
          deliveries: [],
          summary: {
            sources: ['rust'],
          },
        },
        httpClient: createHttpClient({
          fetcher: () => Promise.resolve(new Response('unexpected')),
        }),
        timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
      }),
    Error,
    '[summary] 缺少 stateQuery 依赖 source=summary.daily',
  )
})

Deno.test('source_runtime: summary source 应走 summary parser 且不抓取外部输入', async () => {
  let fetchCalls = 0
  const parsed = await fetchAndParseSource({
    source: {
      id: 'summary.daily',
      name: 'Daily Summary',
      enabled: true,
      deliveries: [],
      summary: {
        sources: ['rust'],
      },
    },
    httpClient: createHttpClient({
      fetcher: () => {
        fetchCalls += 1
        return Promise.resolve(new Response('unexpected'))
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
    summaryOptions: {
      scheduledAt: '2026-04-12T10:00:00.000Z',
      language: 'en-US',
      stateQuery: {
        getSummaryCheckpoint: () => Promise.resolve(undefined),
        getSummaryInputs: () => Promise.resolve({}),
      },
      contentRuntime: createContentRuntime(),
    },
  })

  assertEquals(parsed.parser, 'summary')
  assertEquals(parsed.observedAt, '2026-04-12T10:00:00.000Z')
  assertEquals(parsed.feedMapped.title, 'Daily Summary')
  assertEquals(parsed.entries, [])
  assertEquals(fetchCalls, 0)
})

Deno.test('source_runtime: 未配置解析器时应返回 none 结果', async () => {
  const payload = '<html><body>hello</body></html>'
  const parsed = await fetchAndParseSource({
    source: {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/page.html',
      },
    },
    httpClient: createHttpClient({
      fetcher: () => Promise.resolve(new Response(payload)),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.payload, payload)
  assertEquals(parsed.parser, 'none')
  assertEquals(parsed.feedMapped, {})
  assertEquals(parsed.entries, [])
})

Deno.test('source_runtime: 无 proxy 时应保留 headers 并不注入 client', async () => {
  const calls: Array<{ sourceToken: string; hasClient: boolean }> = []

  const parsed = await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
      headers: {
        'X-Source-Token': 'source-token',
      },
    }),
    httpClient: createHttpClient({
      fetcher: (input, init) => {
        const headers = getRequestHeaders(input, init)
        calls.push({
          sourceToken: String(headers.get('X-Source-Token') ?? ''),
          hasClient: getRequestClient(init) !== undefined,
        })
        return Promise.resolve(new Response(MINIMAL_RSS_PAYLOAD))
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.payload, MINIMAL_RSS_PAYLOAD)
  assertEquals(calls, [{ sourceToken: 'source-token', hasClient: false }])
})

Deno.test('source_runtime: 配置 http proxy 时应注入 client 并在成功后关闭', async () => {
  const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []
  const calls: Array<{ hasExpectedClient: boolean }> = []
  let closeCalls = 0
  const proxyClient = {
    close: () => {
      closeCalls += 1
    },
  } as Deno.HttpClient

  const parsed = await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
      proxy: 'http://127.0.0.1:8080',
    }),
    httpClient: createHttpClient({
      fetcher: (_input, init) => {
        calls.push({
          hasExpectedClient: getRequestClient(init) === proxyClient,
        })
        return Promise.resolve(new Response(MINIMAL_RSS_PAYLOAD))
      },
      proxyClientFactory: (options) => {
        createHttpClientCalls.push(options)
        return proxyClient
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.payload, MINIMAL_RSS_PAYLOAD)
  assertEquals(createHttpClientCalls, [
    {
      proxy: { url: 'http://127.0.0.1:8080' },
    },
  ])
  assertEquals(calls, [{ hasExpectedClient: true }])
  assertEquals(closeCalls, 1)
})

Deno.test('source_runtime: 配置 socks5 proxy 时应注入 client 并在成功后关闭', async () => {
  const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []
  const calls: Array<{ hasExpectedClient: boolean }> = []
  let closeCalls = 0
  const proxyClient = {
    close: () => {
      closeCalls += 1
    },
  } as Deno.HttpClient

  await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
      proxy: 'socks5://127.0.0.1:1080',
    }),
    httpClient: createHttpClient({
      fetcher: (_input, init) => {
        calls.push({
          hasExpectedClient: getRequestClient(init) === proxyClient,
        })
        return Promise.resolve(new Response(MINIMAL_RSS_PAYLOAD))
      },
      proxyClientFactory: (options) => {
        createHttpClientCalls.push(options)
        return proxyClient
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(createHttpClientCalls, [
    {
      proxy: { url: 'socks5://127.0.0.1:1080' },
    },
  ])
  assertEquals(calls, [{ hasExpectedClient: true }])
  assertEquals(closeCalls, 1)
})

Deno.test('source_runtime: 遇到非 2xx 响应时应抛统一抓取错误并关闭 proxy client', async () => {
  let closeCalls = 0
  const proxyClient = {
    close: () => {
      closeCalls += 1
    },
  } as Deno.HttpClient

  await assertRejects(
    () =>
      fetchAndParseSource({
        source: createSyndicationSource({
          url: 'https://example.com/feed.xml',
          proxy: 'http://127.0.0.1:8080',
        }),
        httpClient: createHttpClient({
          fetcher: () => Promise.resolve(new Response('nope', { status: 503 })),
          proxyClientFactory: () => proxyClient,
        }),
        timeOptions: {
          timezone: 'UTC',
          timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        },
      }),
    Error,
    '[source] 抓取失败 source=s1 status=503',
  )

  assertEquals(closeCalls, 1)
})

Deno.test('source_runtime: 配置 http 认证 proxy 时应透传完整 proxy URL', async () => {
  const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []

  await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
      proxy: 'http://user:pass@127.0.0.1:8080',
    }),
    httpClient: createHttpClient({
      fetcher: () => Promise.resolve(new Response(MINIMAL_RSS_PAYLOAD)),
      proxyClientFactory: (options) => {
        createHttpClientCalls.push(options)
        return { close: () => {} } as Deno.HttpClient
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(createHttpClientCalls, [
    {
      proxy: { url: 'http://user:pass@127.0.0.1:8080' },
    },
  ])
})

Deno.test('source_runtime: byparr source 应调用 /v1 并返回渲染后的 payload', async () => {
  const calls: Array<{ requestUrl: string; method: string; headers: Headers; bodyText: string }> =
    []

  const parsed = await fetchAndParseSource({
    source: {
      id: 's-byparr',
      enabled: true,
      deliveries: [],
      byparr: {
        endpoint: 'http://byparr:8191/v1',
        cmd: 'request.get',
        url: 'https://example.com/news',
        maxTimeout: '60s',
        proxy: 'http://user:@127.0.0.1:8080',
      },
      xquery: {
        entry: {
          id: 'string(//article/@id)',
          title: 'string(//article/h2)',
        },
      },
    },
    httpClient: createHttpClient({
      fetcher: async (request, init) => {
        if (request instanceof Request) {
          calls.push({
            requestUrl: request.url,
            method: request.method,
            headers: request.headers,
            bodyText: await request.clone().text(),
          })
        } else {
          calls.push({
            requestUrl: String(request),
            method: String(init?.method ?? 'GET'),
            headers: new Headers(init?.headers),
            bodyText: String(init?.body ?? ''),
          })
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ok',
              message: 'ok',
              solution: {
                url: 'https://example.com/news',
                status: 200,
                response: '<html><body><article id="a1"><h2>Hello</h2></article></body></html>',
              },
              startTimestamp: 1,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      },
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
  })

  assertEquals(parsed.parser, 'xquery')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, 'a1')
  assertEquals(calls.length, 1)

  const call = calls[0]
  assertEquals(call.requestUrl, 'http://byparr:8191/v1')
  assertEquals(call.method, 'POST')

  assertEquals(call.headers.get('X-Proxy-Server'), 'http://127.0.0.1:8080')
  assertEquals(call.headers.get('X-Proxy-Username'), 'user')
  assertEquals(call.headers.get('X-Proxy-Password'), '')

  const payload = JSON.parse(call.bodyText)
  assertEquals(payload.cmd, 'request.get')
  assertEquals(payload.url, 'https://example.com/news')
  assertEquals(payload.max_timeout, 60)
})

Deno.test('source_runtime: byparr 返回 status 非 ok 时应抛统一抓取错误', async () => {
  await assertRejects(
    () =>
      fetchAndParseSource({
        source: {
          id: 's-byparr',
          enabled: true,
          deliveries: [],
          byparr: {
            endpoint: 'http://byparr:8191/v1',
            cmd: 'request.get',
            url: 'https://example.com/news',
            maxTimeout: '60s',
          },
          syndication: {},
        },
        httpClient: createHttpClient({
          fetcher: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  status: 'error',
                  message: 'blocked',
                  solution: {
                    url: 'https://example.com/news',
                    status: 403,
                    response: '',
                  },
                  startTimestamp: 1,
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              ),
            ),
        }),
        timeOptions: {
          timezone: 'UTC',
          timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        },
      }),
    Error,
    '[source] 抓取失败 source=s-byparr status=403',
  )
})

Deno.test('source_runtime: syndication parse 链路可透传 aiRuntime 并支持 ai filter', async () => {
  const aiRequests: Array<Record<string, unknown>> = []
  const aiRuntime = createTestAiRuntime((input) => {
    aiRequests.push(input)
    return Promise.resolve({ text: 'AI Summary' })
  })

  const parsed = await fetchAndParseSource({
    source: {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/feed.xml',
      },
      syndication: {
        entry: {
          id: '{{ id }}',
          description: '{{ description | ai_summarize }}',
        },
      },
    },
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response(
            '<rss><channel><item><guid>id-1</guid><description>need ai</description></item></channel></rss>',
          ),
        ),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
    aiRuntime,
  })

  assertEquals(parsed.entries[0].mapped.description, 'AI Summary')
  assertEquals(aiRequests.length, 1)
})

Deno.test('source_runtime: syndication parse 链路中的 ai 失败应上抛', async () => {
  const aiRuntime = createTestAiRuntime(() =>
    Promise.reject(new Error('AI failed in source runtime')),
  )

  await assertRejects(
    () =>
      fetchAndParseSource({
        source: {
          id: 's1',
          enabled: true,
          deliveries: [],
          http: {
            url: 'https://example.com/feed.xml',
          },
          syndication: {
            entry: {
              id: '{{ id }}',
              description: '{{ description | ai_summarize }}',
            },
          },
        },
        httpClient: createHttpClient({
          fetcher: () =>
            Promise.resolve(
              new Response(
                '<rss><channel><item><guid>id-1</guid><description>need ai</description></item></channel></rss>',
              ),
            ),
        }),
        timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
        aiRuntime,
      }),
    Error,
    'AI failed in source runtime',
  )
})

Deno.test('source_runtime: 应记录最小 fetch/parse runtime 日志且不包含 payload', async () => {
  const logs: Array<Record<string, unknown>> = []

  const parsed = await fetchAndParseSource({
    source: createSyndicationSource({
      url: 'https://example.com/feed.xml',
    }),
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response(`
<rss>
  <channel>
    <title>Feed</title>
    <item>
      <guid>id-1</guid>
      <title>Hello</title>
      <description>secret body text</description>
    </item>
  </channel>
</rss>`),
        ),
    }),
    timeOptions: { timezone: 'UTC', timestampFormat: 'yyyy-MM-dd HH:mm:ss' },
    logger: createTestLogger(logs).child({ 'source.run_id': 'run-1' }),
  } as never)

  assertEquals(parsed.entries.length, 1)
  assertEquals(logs.length, 2)

  const fetchLog = logs.find((line) => line.body === 'source payload 抓取完成')
  const parseLog = logs.find((line) => line.body === 'source payload 解析完成')
  const fetchAttributes = (fetchLog?.attributes ?? {}) as Record<string, unknown>
  const parseAttributes = (parseLog?.attributes ?? {}) as Record<string, unknown>

  assertEquals((fetchLog?.scope as Record<string, unknown>).name, 'source.runtime.fetch')
  assertEquals(fetchAttributes['source.operation'], 'fetch_payload')
  assertEquals(fetchAttributes['source.outcome'], 'success')
  assertEquals(fetchAttributes['source.id'], 's1')
  assertEquals(fetchAttributes['source.run_id'], 'run-1')
  assertEquals(typeof fetchAttributes['source.fetch_duration_ms'], 'number')
  assertEquals('source.payload' in fetchAttributes, false)
  assertEquals(JSON.stringify(fetchLog).includes('secret body text'), false)

  assertEquals((parseLog?.scope as Record<string, unknown>).name, 'source.runtime.parse')
  assertEquals(parseAttributes['source.operation'], 'parse_payload')
  assertEquals(parseAttributes['source.outcome'], 'success')
  assertEquals(parseAttributes['source.id'], 's1')
  assertEquals(parseAttributes['source.run_id'], 'run-1')
  assertEquals(parseAttributes['source.parser'], 'rss')
  assertEquals(parseAttributes['source.item_count'], 1)
  assertEquals(typeof parseAttributes['source.parse_duration_ms'], 'number')
  assertEquals('source.payload' in parseAttributes, false)
  assertEquals(JSON.stringify(parseLog).includes('secret body text'), false)
})
