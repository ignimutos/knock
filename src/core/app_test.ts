import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { emptyDir, ensureDir } from '@std/fs'
import { exists } from '@std/fs/exists'
import { join } from '@std/path'
import { cleanupOwnedRuntime } from '../test_runtime.ts'
import { startApp } from './app.ts'

const registerTest = Deno.test
let currentOwnedRuntimeDirs: string[] | null = null

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    const previousOwnedRuntimeDirs = currentOwnedRuntimeDirs
    const ownedRuntimeDirs: string[] = []
    currentOwnedRuntimeDirs = ownedRuntimeDirs
    try {
      await fn()
    } finally {
      currentOwnedRuntimeDirs = previousOwnedRuntimeDirs
      const uniqueOwnedRuntimeDirs = [...new Set(ownedRuntimeDirs)]
      for (const runtimeDir of uniqueOwnedRuntimeDirs.reverse()) {
        await cleanupOwnedRuntime(runtimeDir)
      }
    }
  })
}

test('app: 未传 immediate 时入口模型应显式视为 false', async () => {
  const testRuntime = getTestRuntime('default-immediate-false')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
sources: {}
`,
  )

  const result = await startApp({ runtimeDir: testRuntime, keepAlive: false })
  assertEquals(result.mode, 'daemon')
})

function getTestRuntime(testName: string): string {
  const runtimeDir = join(Deno.cwd(), '.tmp', `runtime-app-${testName}`)
  currentOwnedRuntimeDirs?.push(runtimeDir)
  return runtimeDir
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getAttributes(record: Record<string, unknown>): Record<string, unknown> {
  return (record.attributes ?? {}) as Record<string, unknown>
}

function getScopeName(record: Record<string, unknown>): string | undefined {
  return ((record.scope ?? {}) as Record<string, unknown>).name as string | undefined
}

function captureLogs(): {
  logs: Array<Record<string, unknown>>
  restore: () => void
} {
  const logs: Array<Record<string, unknown>> = []
  const rawLog = console.log
  const rawWarn = console.warn
  const rawError = console.error
  const push = (...args: unknown[]) => {
    for (const item of args) {
      if (typeof item !== 'string') continue
      try {
        logs.push(JSON.parse(item) as Record<string, unknown>)
      } catch {
        logs.push({ raw: String(item) })
      }
    }
  }
  console.log = (...args: unknown[]) => push(...args)
  console.warn = (...args: unknown[]) => push(...args)
  console.error = (...args: unknown[]) => push(...args)
  return {
    logs,
    restore: () => {
      console.log = rawLog
      console.warn = rawWarn
      console.error = rawError
    },
  }
}

test('app: 启动入口应拒绝非法 keepAlive 类型', async () => {
  await assertRejects(
    () => startApp({ keepAlive: 'yes' as never }),
    Error,
    'keepAlive 必须是布尔值',
  )
})

test('app: 启动入口应拒绝非法 runtimeDir 类型', async () => {
  await assertRejects(
    () => startApp({ runtimeDir: 123 as never }),
    Error,
    'runtimeDir 必须是字符串',
  )
})

test('app: 启动入口应拒绝非法 httpProxyClientFactory 类型', async () => {
  await assertRejects(
    () => startApp({ httpProxyClientFactory: 'not-fn' as never }),
    Error,
    'httpProxyClientFactory 必须是函数',
  )
})

test('app: keepAlive=true 时应允许注入可结束的保活等待', async () => {
  const testRuntime = getTestRuntime('keepalive-with-signal')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
sources: {}
`,
  )

  let released = false
  let release!: () => void
  const keepAliveSignal = new Promise<void>((resolve) => {
    release = () => {
      released = true
      resolve()
    }
  })

  const resultPromise = startApp({
    runtimeDir: testRuntime,
    keepAlive: true,
    keepAliveSignal,
  })

  release()

  const result = await resultPromise
  assertEquals(released, true)
  assertEquals(result.mode, 'daemon')
})

test('app: 仅 schedule 且 keepAlive=true 时应进入长期运行模式并可由信号结束', async () => {
  const testRuntime = getTestRuntime('keepalive-schedule-only')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  local:
    file:
      path: outputs/source.md
      content: "{{ entry.title }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    schedule: "*/5 * * * *"
    syndication:
        entry:
          id: "{{ id }}"
          title: "{{ title }}"
          link: "{{ link }}"
          description: "{{ description }}"
`,
  )

  let release!: () => void
  const keepAliveSignal = new Promise<void>((resolve) => {
    release = resolve
  })

  const { logs, restore } = captureLogs()
  try {
    const resultPromise = startApp({
      runtimeDir: testRuntime,
      keepAlive: true,
      keepAliveSignal,
    })

    await Promise.resolve()
    release()

    const result = await resultPromise
    assertEquals(result.mode, 'daemon')
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'app.startup' &&
          attributes['app.operation'] === 'enter_daemon' &&
          attributes['app.outcome'] === 'success' &&
          attributes['app.has_schedule'] === true
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) =>
        String(line.raw ?? '').includes('Top-level await promise never resolved'),
      ),
      false,
    )
  } finally {
    restore()
  }
})

test('app: HTTP push 失败时应向外传播失败且不持久化 delivered', async () => {
  const testRuntime = getTestRuntime('phase2-http-delivery-failure')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
sqlite:
  path: state/custom.db

deliveries:
  webhook:
    push:
      http:
        method: POST
        url: https://example.com/webhook
      request:
        type: body
        payload:
          text: "{{ entry.title }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    deliveries:
      webhook: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"
`,
  )

  const { logs, restore } = captureLogs()
  try {
    await assertRejects(
      () =>
        startApp({
          runtimeDir: testRuntime,
          httpFetcher: async (input) => {
            if (getRequestUrl(input) === 'https://example.com/webhook') {
              return await Promise.resolve(new Response('upstream failed', { status: 500 }))
            }

            const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello HTTP</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`
            return await Promise.resolve(new Response(xml))
          },
          keepAlive: false,
          immediate: true,
        }),
      Error,
      'HTTP',
    )
  } finally {
    restore()
  }

  assertEquals(
    logs.some((line) => {
      const attributes = getAttributes(line)
      return (
        getScopeName(line) === 'delivery.store' &&
        attributes['delivery.operation'] === 'mark_delivered'
      )
    }),
    false,
  )
  assertEquals(
    logs.some((line) => {
      const attributes = getAttributes(line)
      return (
        getScopeName(line) === 'delivery.http' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'failure'
      )
    }),
    true,
  )

  const databasePath = join(testRuntime, 'state', 'custom.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(databasePath)
  try {
    assertEquals(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM deliveries WHERE source_id = ? AND item_id = ?')
          .get('rust', 'id-1') as { count: number }
      ).count,
      0,
    )
  } finally {
    db.close()
  }
})

test('app: source.http 与 push.http.proxy 应保持 source/delivery 边界，且保留 response failure 语义', async () => {
  const testRuntime = getTestRuntime('phase2-source-http-proxy-and-response')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  const sourceProxyUrl = 'socks5://127.0.0.1:1080'
  const deliveryProxyUrl = 'http://127.0.0.1:9000'

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  webhook:
    push:
      http:
        method: POST
        url: https://example.com/webhook
        headers:
          Authorization: Bearer delivery-token
        proxy: ${deliveryProxyUrl}
      request:
        type: body
        payload:
          text: "{{ entry.title }}"
      response:
        predicate: "{{ ok }}"
        message: "{{ body.error }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
      proxy: ${sourceProxyUrl}
      headers:
        X-Source-Token: source-token
    deliveries:
      webhook: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"
`,
  )

  const createHttpClientCalls: Array<Parameters<typeof Deno.createHttpClient>[0]> = []
  const sourceFetches: Array<{
    sourceToken: string
    authorization: string
    hasExpectedClient: boolean
  }> = []
  const deliveryFetches: Array<{
    authorization: string
    sourceToken: string
    hasExpectedClient: boolean
  }> = []
  let sourceClientCloseCalls = 0
  let deliveryClientCloseCalls = 0
  const { logs, restore } = captureLogs()

  const sourceProxyClient = {
    close: () => {
      sourceClientCloseCalls += 1
    },
  } as Deno.HttpClient
  const deliveryProxyClient = {
    close: () => {
      deliveryClientCloseCalls += 1
    },
  } as Deno.HttpClient

  try {
    await assertRejects(
      () =>
        startApp({
          runtimeDir: testRuntime,
          httpFetcher: async (input, init) => {
            const initWithClient = init as (RequestInit & { client?: Deno.HttpClient }) | undefined
            if (getRequestUrl(input) === 'https://example.com/rust.xml') {
              const headers = input instanceof Request ? input.headers : new Headers(init?.headers)
              sourceFetches.push({
                sourceToken: String(headers.get('X-Source-Token') ?? ''),
                authorization: String(headers.get('Authorization') ?? ''),
                hasExpectedClient: initWithClient?.client === sourceProxyClient,
              })
              const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello HTTP</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`
              return await Promise.resolve(new Response(xml, { status: 200 }))
            }

            const headers = input instanceof Request ? input.headers : new Headers(init?.headers)
            deliveryFetches.push({
              authorization: String(headers.get('Authorization') ?? ''),
              sourceToken: String(headers.get('X-Source-Token') ?? ''),
              hasExpectedClient: initWithClient?.client === deliveryProxyClient,
            })
            return await Promise.resolve(
              new Response('{"error":"delivery failed"}', {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          },
          httpProxyClientFactory: (options) => {
            createHttpClientCalls.push(options)
            const proxyUrl = (options as { proxy?: { url?: string } }).proxy?.url
            if (proxyUrl === sourceProxyUrl) return sourceProxyClient
            if (proxyUrl === deliveryProxyUrl) return deliveryProxyClient
            throw new Error(`unexpected proxy url: ${proxyUrl ?? ''}`)
          },
          keepAlive: false,
          immediate: true,
        }),
      Error,
      'delivery failed',
    )

    assertEquals(createHttpClientCalls, [
      { proxy: { url: sourceProxyUrl } },
      { proxy: { url: deliveryProxyUrl } },
    ])
    assertEquals(
      logs.some((line) => {
        const scope = getScopeName(line)
        const attributes = getAttributes(line)
        return (
          scope === 'scheduler.source' &&
          line.body === 'source 执行失败' &&
          attributes['exception.message'] === 'HTTP 推送失败: status=500'
        )
      }),
      true,
    )
    assertEquals(JSON.stringify(logs).includes('delivery failed'), false)
    assertEquals(sourceFetches, [
      {
        sourceToken: 'source-token',
        authorization: '',
        hasExpectedClient: true,
      },
    ])
    assertEquals(deliveryFetches, [
      {
        authorization: 'Bearer delivery-token',
        sourceToken: '',
        hasExpectedClient: true,
      },
    ])
    assertEquals(sourceClientCloseCalls, 1)
    assertEquals(deliveryClientCloseCalls, 1)
  } finally {
    restore()
  }
})

test('app: immediate 模式下文件模板主链路应可使用 ai_summarize', async () => {
  const testRuntime = getTestRuntime('oneshot-ai-runtime')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  const aiRequests: Array<Record<string, unknown>> = []
  const aiServer = Deno.serve({ hostname: '127.0.0.1', port: 0 }, async (request) => {
    aiRequests.push((await request.json()) as Record<string, unknown>)
    return new Response(
      JSON.stringify({
        id: 'resp_1',
        created_at: 1_710_000_000,
        model: 'gpt-4o-mini',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'msg_1',
            content: [
              {
                type: 'output_text',
                text: 'AI 摘要',
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  })

  try {
    await Deno.writeTextFile(
      join(testRuntime, 'config.yml'),
      `
language: zh-CN
ai:
  defaultModel: openai_main/default
  providers:
    openai_main:
      type: openai
      apiKey: test-key
      baseURL: http://127.0.0.1:${aiServer.addr.port}/v1
      models:
        default:
          model: gpt-4o-mini
          context: 8192
          maxOutputTokens: 400

deliveries:
  local:
    file:
      path: outputs/source.md
      content: "{{ entry.description | ai_summarize }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"
    deliveries:
      local: {}
`,
    )

    const result = await startApp({
      runtimeDir: testRuntime,
      httpFetcher: async () => {
        const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello Rust</title>
      <description>需要摘要的正文</description>
    </item>
  </channel>
</rss>`
        return await Promise.resolve(new Response(xml))
      },
      keepAlive: false,
      immediate: true,
    })

    assertEquals(result.mode, 'daemon')
    const output = await Deno.readTextFile(join(testRuntime, 'outputs', 'source.md'))
    assertStringIncludes(output, 'AI 摘要')
    assertEquals(aiRequests.length, 1)
  } finally {
    await aiServer.shutdown()
  }
})

test('app: immediate 模式下 summary source 首跑只写 checkpoint、不投递文件且不抓取外部 source', async () => {
  const testRuntime = getTestRuntime('oneshot-summary-first-run')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
sqlite:
  path: state/custom.db

deliveries:
  local:
    file:
      path: outputs/summary.md
      content: "{{ entry.title }}"

sources:
  rust:
    enabled: false
    http:
      url: https://example.com/rust.xml
    deliveries: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"

  summary_daily:
    name: Daily Summary
    schedule: "*/5 * * * *"
    summary:
      sources:
        - rust
    deliveries:
      local: {}
`,
  )

  let fetchCalls = 0
  const result = await startApp({
    runtimeDir: testRuntime,
    httpFetcher: async () => {
      fetchCalls += 1
      return await Promise.resolve(new Response('<rss></rss>'))
    },
    keepAlive: false,
    immediate: true,
  })

  assertEquals(result.mode, 'daemon')
  assertEquals(fetchCalls, 0)
  assertEquals(await exists(join(testRuntime, 'outputs', 'summary.md')), false)

  const databasePath = join(testRuntime, 'state', 'custom.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(databasePath)
  try {
    const feedRow = db
      .prepare(
        'SELECT source_id, parser, payload_text, fetched_at, updated_at FROM feeds WHERE source_id = ?',
      )
      .get('summary_daily') as {
      source_id: string
      parser: string
      payload_text: string
      fetched_at: string
      updated_at: string
    }
    assertEquals(feedRow.source_id, 'summary_daily')
    assertEquals(feedRow.parser, 'summary')
    assertEquals(feedRow.fetched_at, feedRow.updated_at)
    assertEquals(JSON.parse(feedRow.payload_text), {
      kind: 'summary',
      sourceId: 'summary_daily',
      sourceIds: ['rust'],
      previousCheckpoint: null,
      scheduledAt: feedRow.fetched_at,
    })
    assertEquals(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM entries WHERE source_id = ?')
          .get('summary_daily') as {
          count: number
        }
      ).count,
      0,
    )
    assertEquals(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM deliveries WHERE source_id = ?')
          .get('summary_daily') as {
          count: number
        }
      ).count,
      0,
    )
  } finally {
    db.close()
  }
})

test('app: immediate 模式应执行一次并进入非调度模式', async () => {
  const testRuntime = getTestRuntime('oneshot')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  local:
    file:
      path: outputs/source.md
      content: "{{ entry.title }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    schedule: "*/5 * * * *"
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        link: "{{ link }}"
        description: "{{ description }}"
    deliveries:
      local: {}
    filter: "{{ entry.title != '' }}"
`,
  )

  const { logs, restore } = captureLogs()
  try {
    const result = await startApp({
      runtimeDir: testRuntime,
      httpFetcher: async () => {
        const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello Rust</title>
      <link>https://example.com/post</link>
      <description>desc</description>
    </item>
  </channel>
</rss>`
        return await Promise.resolve(new Response(xml))
      },
      keepAlive: false,
      immediate: true,
    })

    assertEquals(result.mode, 'daemon')
    const output = await Deno.readTextFile(join(testRuntime, 'outputs', 'source.md'))
    assertStringIncludes(output, 'Hello Rust')

    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'app.startup' &&
          attributes['app.operation'] === 'startup' &&
          attributes['app.outcome'] === 'success' &&
          attributes['source.count'] === 1 &&
          attributes['source.enabled_count'] === 1 &&
          attributes['source.disabled_count'] === 0 &&
          attributes['delivery.count'] === 1 &&
          attributes['scheduler.scheduled_source_count'] === 1
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => getAttributes(line)['app.operation'] === 'enter_daemon'),
      false,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'db.sqlite' &&
          attributes['db.operation'] === 'init_db' &&
          attributes['db.outcome'] === 'success'
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'source.runtime.fetch' &&
          attributes['source.run_id'] ===
            'source.rust.' + String(attributes['source.run_id']).split('source.rust.')[1]
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'delivery.runtime.render' &&
          attributes['delivery.operation'] === 'render_content' &&
          attributes['delivery.id'] === 'rust__local'
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'delivery.runtime.build' &&
          attributes['delivery.operation'] === 'build_request' &&
          attributes['delivery.id'] === 'rust__local'
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'delivery.runtime.dispatch' &&
          attributes['delivery.operation'] === 'dispatch' &&
          attributes['delivery.id'] === 'rust__local'
        )
      }),
      true,
    )
  } finally {
    restore()
  }
})

test('app: 配置 schedule 时应进入长期运行模式', async () => {
  const testRuntime = getTestRuntime('daemon')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  local:
    file:
      path: outputs/source.md
      content: "{{ entry.title }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    schedule: "*/5 * * * *"
    deliveries:
      local: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        link: "{{ link }}"
        description: "{{ description }}"
`,
  )

  const { logs, restore } = captureLogs()
  try {
    const result = await startApp({
      runtimeDir: testRuntime,
      httpFetcher: async () => {
        const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello Scheduled</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`
        return await Promise.resolve(new Response(xml))
      },
      keepAlive: false,
    })

    assertEquals(result.mode, 'daemon')
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'scheduler.source' &&
          attributes['scheduler.operation'] === 'register_schedule' &&
          attributes['scheduler.outcome'] === 'success' &&
          attributes['scheduler.schedule'] === '*/5 * * * *'
        )
      }),
      true,
    )
    assertEquals(
      logs.some((line) => {
        const attributes = getAttributes(line)
        return (
          getScopeName(line) === 'app.startup' &&
          attributes['app.operation'] === 'enter_daemon' &&
          attributes['app.outcome'] === 'success' &&
          attributes['app.has_schedule'] === true
        )
      }),
      true,
    )
  } finally {
    restore()
  }
})

test('app: enabled=false 的 source 不应启动执行也不应注册调度', async () => {
  const testRuntime = getTestRuntime('disabled-source')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  local:
    file:
      path: outputs/source.md
      content: "{{ entry.title }}"

sources:
  rust:
    enabled: false
    http:
      url: https://example.com/rust.xml
    schedule: "*/5 * * * *"
    deliveries:
      local: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"
`,
  )

  let fetchCalls = 0
  const { logs, restore } = captureLogs()
  try {
    const result = await startApp({
      runtimeDir: testRuntime,
      httpFetcher: async () => {
        fetchCalls += 1
        return await Promise.resolve(new Response('<rss></rss>'))
      },
      keepAlive: false,
      immediate: true,
    })

    assertEquals(result.mode, 'daemon')
    assertEquals(fetchCalls, 0)
    assertEquals(await exists(join(testRuntime, 'outputs', 'source.md')), false)
    assertEquals(
      logs.some((line) => getAttributes(line)['scheduler.reason'] === 'source_disabled'),
      false,
    )
    assertEquals(
      logs.some((line) => getAttributes(line)['scheduler.operation'] === 'run_source'),
      false,
    )
    assertEquals(
      logs.some((line) => getAttributes(line)['scheduler.operation'] === 'register_schedule'),
      false,
    )
    assertEquals(
      logs.some((line) => getAttributes(line)['app.operation'] === 'enter_daemon'),
      false,
    )
  } finally {
    restore()
  }
})

test('app: email 发送失败时应向外传播失败且不持久化 delivered', async () => {
  const testRuntime = getTestRuntime('phase2-email-delivery-failure')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
sqlite:
  path: state/custom.db

deliveries:
  release_email:
    email:
      smtp:
        host: smtp.example.com
        port: 587
        security: starttls
      message:
        from: bot@example.com
        to:
          - team@example.com
        subject: "{{ entry.title }}"
        text: "{{ entry.description }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    deliveries:
      release_email: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
        description: "{{ description }}"
`,
  )

  const { logs, restore } = captureLogs()
  try {
    await assertRejects(
      () =>
        startApp({
          runtimeDir: testRuntime,
          httpFetcher: async () => {
            const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello Email</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`
            return await Promise.resolve(new Response(xml))
          },
          emailTransportFactory: () =>
            ({
              sendMail: () => Promise.reject(new Error('smtp failed')),
            }) as never,
          keepAlive: false,
          immediate: true,
        }),
      Error,
      'smtp failed',
    )
  } finally {
    restore()
  }

  assertEquals(
    logs.some((line) => {
      const attributes = getAttributes(line)
      return (
        getScopeName(line) === 'delivery.store' &&
        attributes['delivery.operation'] === 'mark_delivered'
      )
    }),
    false,
  )
  assertEquals(
    logs.some((line) => {
      const attributes = getAttributes(line)
      return (
        getScopeName(line) === 'delivery.email' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'failure'
      )
    }),
    true,
  )

  const databasePath = join(testRuntime, 'state', 'custom.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(databasePath)
  try {
    assertEquals(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM deliveries WHERE source_id = ? AND item_id = ?')
          .get('rust', 'id-1') as { count: number }
      ).count,
      0,
    )
  } finally {
    db.close()
  }
})

test('app: push 直连 Telegram API 时日志不应泄露 token/chat_id', async () => {
  const testRuntime = getTestRuntime('telegram-redaction')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  webhook:
    push:
      http:
        method: POST
        url: https://api.telegram.org/bot123456:ABCDEF-SECRET/sendMessage
      request:
        type: body
        payload:
          chat_id: "987654321"
          text: "{{ entry.title }}"

sources:
  rust:
    http:
      url: https://example.com/rust.xml
    deliveries:
      webhook: {}
    syndication:
        entry:
          id: "{{ id }}"
          title: "{{ title }}"
          description: "{{ description }}"
`,
  )

  const { logs, restore } = captureLogs()
  try {
    await startApp({
      runtimeDir: testRuntime,
      httpFetcher: async (input) => {
        if (getRequestUrl(input).includes('api.telegram.org')) {
          return await Promise.resolve(
            new Response('{"ok":true,"result":{"message_id":1}}', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        const xml = `
<rss>
  <channel>
    <item>
      <guid>id-1</guid>
      <title>Hello Telegram</title>
      <description>desc</description>
    </item>
  </channel>
</rss>`
        return await Promise.resolve(new Response(xml))
      },
      keepAlive: false,
      immediate: true,
    })
  } finally {
    restore()
  }

  const output = JSON.stringify(logs)
  assertEquals(output.includes('987654321'), false)
  assertEquals(output.includes('123456:ABCDEF-SECRET'), false)
  assertEquals(output.includes('api.telegram.org/bot123456:ABCDEF-SECRET'), false)
  assertEquals(
    logs.some((line) => {
      const attributes = getAttributes(line)
      return (
        getScopeName(line) === 'delivery.http' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'success' &&
        attributes['delivery.id'] === 'rust__webhook'
      )
    }),
    true,
  )
})
