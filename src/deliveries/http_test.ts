import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { attachAiEntryRuntime, createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createHttpClient } from '../core/http_client.ts'
import { createLogger } from '../core/logger.ts'
import { createHttpDelivery } from './http.ts'

// risk-id: R07
// layer: contract

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

function parseLogs(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

function findHttpFailureLog(
  logs: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return logs.find((item) => {
    const scope = (item.scope ?? {}) as Record<string, unknown>
    const attributes = (item.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'delivery.http' &&
      attributes['delivery.operation'] === 'push' &&
      attributes['delivery.outcome'] === 'failure'
    )
  })
}

function getAttributes(record: Record<string, unknown> | undefined): Record<string, unknown> {
  return (record?.attributes ?? {}) as Record<string, unknown>
}

Deno.test('[contract] httpDelivery: body 请求应发送 JSON body 与合并后的 headers', async () => {
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

Deno.test('[contract] httpDelivery: query 请求应把 payload 编码到 query string', async () => {
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

Deno.test('[contract] httpDelivery: form 请求应默认设置 form content-type', async () => {
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

Deno.test('[contract] httpDelivery: query payload 非对象/字符串时应报错', async () => {
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

Deno.test('[contract] httpDelivery: form payload 非对象时应报错', async () => {
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
  '[contract] httpDelivery: 配置 http proxy 时应把 client 注入 fetch init 并在完成后关闭',
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
  '[contract] httpDelivery: 配置 socks5 proxy 时应把 client 注入 fetch init 并在完成后关闭',
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
  '[contract] httpDelivery: response predicate 与 message 应走注入 aiRuntime 的统一渲染链且日志不泄露模板结果',
  async () => {
    const aiCalls: Array<Record<string, unknown>> = []
    const logs: string[] = []
    const logger = createLogger({
      enabled: true,
      level: 'info',
      module: 'delivery.http',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    })
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
      logger,
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

    const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
    const failureLog = output.find((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'delivery.http' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'failure'
      )
    })
    const failureAttributes = (failureLog?.attributes ?? {}) as Record<string, unknown>
    assertEquals(Boolean(failureLog), true)
    assertEquals(failureAttributes['delivery.reason'], 'response_predicate_false')
    assertEquals(failureAttributes['exception.message'], 'HTTP 推送失败: status=500')
    assertEquals(JSON.stringify(failureLog).includes('AI 摘要'), false)
    assertEquals(JSON.stringify(failureLog).includes('需要摘要的正文'), false)
  },
)

Deno.test('[contract] httpDelivery: 成功响应时不应渲染 failure message 模板', async () => {
  const renderedTemplates: string[] = []
  const delivery = createHttpDelivery({
    httpClient: createHttpClient({
      fetcher: () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    }),
    renderContent: (template, _context) => {
      renderedTemplates.push(template)
      if (template === '{{ ok }}') return Promise.resolve('true')
      return Promise.resolve(`rendered:${template}`)
    },
  })

  await delivery.push({
    deliveryId: 'webhook',
    http: {
      method: 'POST',
      url: 'https://example.com/webhook',
    },
    request: {
      type: 'body',
    },
    response: {
      predicate: '{{ ok }}',
      message: '{{ body }}',
    },
  })

  assertEquals(renderedTemplates, ['{{ ok }}'])
})

Deno.test('[contract] httpDelivery: transport throw 时应记录统一 failure 日志', async () => {
  const logs: string[] = []
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
      fetcher: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8080')),
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
          type: 'body',
          payload: {
            text: 'Hello',
          },
        },
      }),
    Error,
    'connect ECONNREFUSED 127.0.0.1:8080',
  )

  const failureLog = findHttpFailureLog(parseLogs(logs))
  const failureAttributes = getAttributes(failureLog)
  assertEquals(Boolean(failureLog), true)
  assertEquals(failureAttributes['delivery.reason'], 'transport_error')
  assertEquals(failureAttributes['exception.message'], 'HTTP 推送失败: transport_error')
  assertEquals(JSON.stringify(failureLog).includes('ECONNREFUSED'), false)
})

Deno.test(
  '[contract] httpDelivery: 2xx 且无 response 检查时 invalid JSON 不应导致失败',
  async () => {
    const delivery = createHttpDelivery({
      httpClient: createHttpClient({
        fetcher: () =>
          Promise.resolve(
            new Response('{', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
    })

    await delivery.push({
      deliveryId: 'webhook',
      http: {
        method: 'POST',
        url: 'https://example.com/webhook',
      },
      request: {
        type: 'body',
      },
    })
  },
)

Deno.test(
  '[contract] httpDelivery: 需要 response body 时 invalid JSON 应记录 parse failure 日志',
  async () => {
    const logs: string[] = []
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
            new Response('{', {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
      renderContent: (template, context) => {
        if (template === '{{ body.ok }}') {
          return Promise.resolve(String((context.body as { ok?: unknown } | undefined)?.ok ?? ''))
        }
        return Promise.resolve(`rendered:${template}`)
      },
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
            predicate: '{{ body.ok }}',
          },
        }),
      Error,
    )

    const failureLog = findHttpFailureLog(parseLogs(logs))
    const failureAttributes = getAttributes(failureLog)
    assertEquals(Boolean(failureLog), true)
    assertEquals(failureAttributes['delivery.reason'], 'response_parse_error')
    assertEquals(failureAttributes['http.response.status_code'], 500)
    assertEquals(failureAttributes['exception.message'], 'HTTP 推送失败: response_parse_error')
  },
)

Deno.test(
  '[contract] httpDelivery: predicate render throw 时应记录 predicate render failure 日志',
  async () => {
    const logs: string[] = []
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
          Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 500 })),
      }),
      renderContent: (template) => {
        if (template === '{{ broken_predicate }}') {
          return Promise.reject(new Error('predicate render exploded with raw body'))
        }
        return Promise.resolve('ignored')
      },
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
            predicate: '{{ broken_predicate }}',
            message: '{{ body }}',
          },
        }),
      Error,
      'predicate render exploded with raw body',
    )

    const failureLog = findHttpFailureLog(parseLogs(logs))
    const failureAttributes = getAttributes(failureLog)
    assertEquals(Boolean(failureLog), true)
    assertEquals(failureAttributes['delivery.reason'], 'response_predicate_render_error')
    assertEquals(
      failureAttributes['exception.message'],
      'HTTP 推送失败: response_predicate_render_error',
    )
    assertEquals(JSON.stringify(failureLog).includes('raw body'), false)
  },
)

Deno.test(
  '[contract] httpDelivery: message render throw 时应记录 message render failure 日志',
  async () => {
    const logs: string[] = []
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
          Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 500 })),
      }),
      renderContent: (template) => {
        if (template === '{{ always_false }}') return Promise.resolve('false')
        if (template === '{{ broken_message }}') {
          return Promise.reject(new Error('message render leaked rendered body'))
        }
        return Promise.resolve('ignored')
      },
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
            predicate: '{{ always_false }}',
            message: '{{ broken_message }}',
          },
        }),
      Error,
      'message render leaked rendered body',
    )

    const failureLog = findHttpFailureLog(parseLogs(logs))
    const failureAttributes = getAttributes(failureLog)
    assertEquals(Boolean(failureLog), true)
    assertEquals(failureAttributes['delivery.reason'], 'response_message_render_error')
    assertEquals(failureAttributes['http.response.status_code'], 500)
    assertEquals(
      failureAttributes['exception.message'],
      'HTTP 推送失败: response_message_render_error',
    )
    assertEquals(JSON.stringify(failureLog).includes('rendered body'), false)
  },
)

Deno.test('[flow] R07 httpDelivery: 非 2xx 响应时应抛错并记录 failure 日志', async () => {
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
  const failureLog = output.find((item) => {
    const scope = (item.scope ?? {}) as Record<string, unknown>
    const attributes = (item.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'delivery.http' &&
      attributes['delivery.operation'] === 'push' &&
      attributes['delivery.outcome'] === 'failure'
    )
  })
  const failureAttributes = (failureLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(Boolean(failureLog), true)
  assertEquals(failureAttributes['http.response.status_code'], 500)
  assertEquals(failureAttributes['delivery.reason'], 'http_status_not_ok')
  assertEquals('response_body' in failureAttributes, false)
  assertEquals(JSON.stringify(failureLog).includes("can't parse entities"), false)
  assertEquals(failureAttributes['exception.message'], 'HTTP 推送失败: status=500')
  assertEquals(closeCalls, 1)
})
