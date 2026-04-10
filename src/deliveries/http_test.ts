import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { attachAiEntryRuntime, createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createHttpClient } from '../core/http_client.ts'
import { createLogger } from '../core/logger.ts'
import { createHttpDelivery } from './http.ts'

function getRequestClient(init: RequestInit | undefined): Deno.HttpClient | undefined {
  return (init as (RequestInit & { client?: Deno.HttpClient }) | undefined)?.client
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  if (input instanceof Request) return input.headers
  return new Headers(init?.headers)
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string | undefined {
  if (input instanceof Request) return input.method
  return init?.method
}

Deno.test('httpDelivery: body 请求应发送 JSON body 与合并后的 headers', async () => {
  const calls: Array<{
    input: RequestInfo | URL
    init?: RequestInit
    body: string
    method?: string
  }> = []

  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: async (input, init) => {
        const body =
          input instanceof Request ? await input.clone().text() : String(init?.body ?? '')
        calls.push({
          input,
          init,
          body,
          method: getRequestMethod(input, init),
        })
        return Promise.resolve(new Response('ok', { status: 200 }))
      },
    }),
  })

  await delivery.push({
    deliveryId: 'webhook',
    http: {
      method: 'POST',
      url: 'https://example.com/webhook',
      headers: {
        Authorization: 'Bearer token',
      },
    },
    request: {
      type: 'body',
      payload: {
        text: 'Hello',
        link_preview_options: {
          url: 'https://example.com/post',
          is_disabled: false,
          show_above_text: true,
        },
      },
    },
  })

  assertEquals(calls.length, 1)
  assertEquals(getRequestUrl(calls[0].input), 'https://example.com/webhook')
  assertEquals(calls[0].method, 'POST')
  const headers = getRequestHeaders(calls[0].input, calls[0].init)
  assertEquals(headers.get('Authorization'), 'Bearer token')
  assertEquals(headers.get('Content-Type'), 'application/json')
  assertEquals(
    calls[0].body,
    JSON.stringify({
      text: 'Hello',
      link_preview_options: {
        url: 'https://example.com/post',
        is_disabled: false,
        show_above_text: true,
      },
    }),
  )
  assertEquals(getRequestClient(calls[0].init), undefined)
})

Deno.test('httpDelivery: query 请求应把 payload 编码到 query string', async () => {
  const calls: Array<RequestInfo | URL> = []

  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: (input) => {
        calls.push(input)
        return Promise.resolve(new Response('ok', { status: 200 }))
      },
    }),
  })

  await delivery.push({
    deliveryId: 'webhook',
    http: {
      method: 'GET',
      url: 'https://example.com/webhook',
    },
    request: {
      type: 'query',
      payload: {
        text: 'Hello HTTP',
        ok: true,
      },
    },
  })

  assertEquals(calls.length, 1)
  const url = getRequestUrl(calls[0])
  assertStringIncludes(url, 'https://example.com/webhook?')
  assertStringIncludes(url, 'text=Hello+HTTP')
  assertStringIncludes(url, 'ok=true')
})

Deno.test('httpDelivery: form 请求应默认设置 form content-type', async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit; body: string }> = []

  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: async (input, init) => {
        const body =
          input instanceof Request ? await input.clone().text() : String(init?.body ?? '')
        calls.push({ input, init, body })
        return Promise.resolve(new Response('ok', { status: 200 }))
      },
    }),
  })

  await delivery.push({
    deliveryId: 'webhook',
    http: {
      method: 'POST',
      url: 'https://example.com/webhook',
    },
    request: {
      type: 'form',
      payload: {
        text: 'Hello',
        link_preview_options: {
          url: 'https://example.com/post',
          is_disabled: false,
          show_above_text: true,
        },
      },
    },
  })

  const headers = getRequestHeaders(calls[0].input, calls[0].init)
  assertEquals(headers.get('Content-Type'), 'application/x-www-form-urlencoded')
  assertEquals(
    calls[0].body,
    'text=Hello&link_preview_options=%7B%22url%22%3A%22https%3A%2F%2Fexample.com%2Fpost%22%2C%22is_disabled%22%3Afalse%2C%22show_above_text%22%3Atrue%7D',
  )
})

Deno.test('httpDelivery: query payload 非对象/字符串时应报错', async () => {
  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: () => Promise.resolve(new Response('ok', { status: 200 })),
    }),
  })

  await assertRejects(
    () =>
      delivery.push({
        deliveryId: 'webhook',
        http: {
          method: 'GET',
          url: 'https://example.com/webhook',
        },
        request: {
          type: 'query',
          payload: [1, 2, 3],
        },
      }),
    Error,
    'HTTP query payload 必须是对象或字符串',
  )
})

Deno.test('httpDelivery: form payload 非对象时应报错', async () => {
  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: () => Promise.resolve(new Response('ok', { status: 200 })),
    }),
  })

  await assertRejects(
    () =>
      delivery.push({
        deliveryId: 'webhook',
        http: {
          method: 'POST',
          url: 'https://example.com/webhook',
        },
        request: {
          type: 'form',
          payload: 'text=hello',
        },
      }),
    Error,
    'HTTP form payload 必须是对象',
  )
})

Deno.test(
  'httpDelivery: 配置 http proxy 时应把 client 注入 fetch init 并在完成后关闭',
  async () => {
    const calls: Array<RequestInit | undefined> = []
    const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []
    let closeCalls = 0
    const proxyClient = {
      close: () => {
        closeCalls += 1
      },
    } as Deno.HttpClient

    const delivery = createHttpDelivery({
      httpClient: createHttpClient({
        fetcher: (_input, init) => {
          calls.push(init)
          return Promise.resolve(new Response('ok', { status: 200 }))
        },
        proxyClientFactory: (options) => {
          createHttpClientCalls.push(options)
          return proxyClient
        },
      }),
    })

    await delivery.push({
      deliveryId: 'webhook',
      http: {
        method: 'POST',
        url: 'https://example.com/webhook',
        proxy: 'http://127.0.0.1:8080',
      },
      request: {
        type: 'body',
        payload: {
          text: 'Hello',
        },
      },
    })

    assertEquals(createHttpClientCalls.length, 1)
    assertEquals(createHttpClientCalls[0], {
      proxy: {
        url: 'http://127.0.0.1:8080',
      },
    })
    assertEquals(getRequestClient(calls[0]), proxyClient)
    assertEquals(closeCalls, 1)
  },
)

Deno.test(
  'httpDelivery: 配置 socks5 proxy 时应把 client 注入 fetch init 并在完成后关闭',
  async () => {
    const calls: Array<RequestInit | undefined> = []
    const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []
    let closeCalls = 0
    const proxyClient = {
      close: () => {
        closeCalls += 1
      },
    } as Deno.HttpClient

    const delivery = createHttpDelivery({
      httpClient: createHttpClient({
        fetcher: (_input, init) => {
          calls.push(init)
          return Promise.resolve(new Response('ok', { status: 200 }))
        },
        proxyClientFactory: (options) => {
          createHttpClientCalls.push(options)
          return proxyClient
        },
      }),
    })

    await delivery.push({
      deliveryId: 'webhook',
      http: {
        method: 'POST',
        url: 'https://example.com/webhook',
        proxy: 'socks5://127.0.0.1:1080',
      },
      request: {
        type: 'body',
        payload: {
          text: 'Hello',
        },
      },
    })

    assertEquals(createHttpClientCalls.length, 1)
    assertEquals(createHttpClientCalls[0], {
      proxy: {
        url: 'socks5://127.0.0.1:1080',
      },
    })
    assertEquals(getRequestClient(calls[0]), proxyClient)
    assertEquals(closeCalls, 1)
  },
)

Deno.test(
  'httpDelivery: response predicate 与 message 应走注入 aiRuntime 的统一渲染链',
  async () => {
    const aiCalls: Array<Record<string, unknown>> = []
    const aiRuntime = createAiRuntime({
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
      generateText: (input) => {
        aiCalls.push(input as unknown as Record<string, unknown>)
        return Promise.resolve({ text: 'AI 摘要' })
      },
    })
    const contentRuntime = createContentRuntime({ aiRuntime })
    const delivery = createHttpDelivery({
      httpClient: createHttpClient({
        fetcher: () =>
          Promise.resolve(
            new Response(JSON.stringify({ text: '需要摘要的正文' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
      renderContent: (template, context) => contentRuntime.renderContent(template, context),
    })

    await assertRejects(
      () =>
        delivery.push({
          deliveryId: 'webhook',
          http: {
            method: 'POST',
            url: 'https://example.com/webhook',
          },
          request: {
            type: 'body',
          },
          response: {
            predicate: '{{ body.text | ai_summarize | match_exact: "not-ai" }}',
            message: '{{ body.text | ai_summarize }}',
          },
          templateContext: attachAiEntryRuntime(
            {
              entry: { id: 'entry-1' },
            },
            aiRuntime.createEntryRuntime('source-a', 'entry-1'),
          ),
        }),
      Error,
      'AI 摘要',
    )

    assertEquals(aiCalls.length, 1)
  },
)

Deno.test('httpDelivery: 非 2xx 响应时应抛错并记录 failure 日志', async () => {
  const logs: string[] = []
  let closeCalls = 0
  const proxyClient = {
    close: () => {
      closeCalls += 1
    },
  } as Deno.HttpClient
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.http',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })

  const delivery = createHttpDelivery({
    logger,
    httpClient: createHttpClient({
      fetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
      proxyClientFactory: () => proxyClient,
    }),
  })

  await assertRejects(
    () =>
      delivery.push({
        deliveryId: 'webhook',
        http: {
          method: 'POST',
          url: 'https://example.com/webhook',
          proxy: 'http://127.0.0.1:8080',
        },
        request: {
          type: 'body',
          payload: {
            text: 'Hello',
          },
        },
      }),
    Error,
    'HTTP 推送失败: status=500',
  )

  const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  const failureLog = output.find(
    (item) =>
      item.module === 'delivery.http' && item.operation === 'push' && item.outcome === 'failure',
  )
  assertEquals(Boolean(failureLog), true)
  assertEquals(failureLog?.http_status, 500)
  assertEquals(
    failureLog?.response_body,
    JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }),
  )
  assertEquals(closeCalls, 1)
})
