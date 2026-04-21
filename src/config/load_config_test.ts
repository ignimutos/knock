import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { createLogger } from '../core/logger.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { loadCompiledConfig } from './load_compiled_config.ts'
import { loadConfig } from './load_config.ts'

const PROJECT_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))))
const TEST_RUNTIME = join(PROJECT_ROOT, '.tmp', 'runtime-load-config')
const README_PATH = join(PROJECT_ROOT, 'README.md')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  const layeredName = name.startsWith('[') ? name : `[contract] ${name}`
  registerTest(layeredName, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('loadConfig: 应递归展开配置中的环境变量字符串', async () => {
  Deno.env.set('KNOCK_TEST_WEBHOOK_URL', 'https://example.com/webhook')
  Deno.env.set('KNOCK_TEST_WEBHOOK_TOKEN', 'env-token')
  Deno.env.set('KNOCK_TEST_SOURCE_URL', 'https://example.com/feed.xml')
  Deno.env.set('KNOCK_TEST_FILE_PATH', 'outputs/feed.md')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
deliveries:
  webhook:
    push:
      http:
        url: ${'${KNOCK_TEST_WEBHOOK_URL}'}
        headers:
          Authorization: Bearer ${'${KNOCK_TEST_WEBHOOK_TOKEN}'}
      request:
        payload:
          auth: Bearer ${'${KNOCK_TEST_WEBHOOK_TOKEN}'}
          nested:
            - ${'${KNOCK_TEST_WEBHOOK_TOKEN}'}
  archive:
    file:
      path: ${'${KNOCK_TEST_FILE_PATH}'}
      content: "{{ entry.title }}"

sources:
  rust:
    http:
      url: ${'${KNOCK_TEST_SOURCE_URL}'}
    deliveries:
      webhook: {}
      archive: {}
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
`,
    )

    const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
    const webhookDelivery = config.deliveries.find((delivery) => delivery.id === 'webhook')
    const archiveDelivery = config.deliveries.find((delivery) => delivery.id === 'archive')

    assertEquals(webhookDelivery?.push?.http.url, 'https://example.com/webhook')
    assertEquals(webhookDelivery?.push?.http.headers?.Authorization, 'Bearer env-token')
    assertEquals(webhookDelivery?.push?.request.payload, {
      auth: 'Bearer env-token',
      nested: ['env-token'],
    })
    assertEquals(archiveDelivery?.file?.path, join(TEST_RUNTIME, 'outputs', 'feed.md'))
    assertEquals(config.sources[0].http?.url, 'https://example.com/feed.xml')
  } finally {
    Deno.env.delete('KNOCK_TEST_WEBHOOK_URL')
    Deno.env.delete('KNOCK_TEST_WEBHOOK_TOKEN')
    Deno.env.delete('KNOCK_TEST_SOURCE_URL')
    Deno.env.delete('KNOCK_TEST_FILE_PATH')
  }
})

test('loadConfig: 支持环境变量展开的 email.from 应成功展开', async () => {
  Deno.env.set('KNOCK_TEST_EMAIL_URL', 'https://example.com/template')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
deliveries:
  release_email:
    email:
      message:
        from: "${'${KNOCK_TEST_EMAIL_URL}'}"
        to:
          - team@example.com
        subject: hello
        text: world
      smtp:
        host: smtp.example.com
        port: 587
        security: starttls

sources: {}
`,
    )

    const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
    assertEquals(config.deliveries[0].email?.message.from, 'https://example.com/template')
  } finally {
    Deno.env.delete('KNOCK_TEST_EMAIL_URL')
  }
})

test('loadConfig: 应解析 logging file sink 与 time rotation', async () => {
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
logging:
  level: debug
  sinks:
    console:
      type: console
      format: pretty
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
      rotation:
        type: time
        interval: daily
        maxAge: 7d
`,
  )

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(config.logging, {
    level: 'debug',
    sinks: {
      console: {
        type: 'console',
        format: 'pretty',
      },
      file: {
        type: 'file',
        format: 'jsonl',
        path: join(TEST_RUNTIME, 'logs', 'app.jsonl'),
        rotation: {
          type: 'time',
          interval: 'daily',
          maxAge: '7d',
        },
      },
    },
  })
})

test('loadConfig: source.deliveries keyed map 应保留普通声明顺序并映射到 resolved delivery', async () => {
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
deliveries:
  first:
    file:
      path: first.md
      content: first
  second:
    file:
      path: second.md
      content: second

sources:
  feed:
    http:
      url: https://example.com/feed.xml
    deliveries:
      second: {}
      first: {}
`,
  )

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(
    config.sources[0].deliveries.map((delivery) => delivery.id),
    ['feed__second', 'feed__first'],
  )
  assertEquals(
    config.sources[0].deliveries.map((delivery) => delivery.file?.content),
    ['second', 'first'],
  )
})

test('R04 loadConfig: 缺失环境变量时应报出配置路径', async () => {
  Deno.env.delete('KNOCK_TEST_MISSING_TOKEN')

  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
deliveries:
  webhook:
    push:
      http:
        url: https://example.com/webhook
        headers:
          Authorization: Bearer ${'${KNOCK_TEST_MISSING_TOKEN}'}

sources: {}
`,
  )

  const err = await assertRejects(() => loadConfig({ runtimeDir: TEST_RUNTIME }), Error)
  assertStringIncludes(err.message, 'deliveries.webhook.push.http.headers.Authorization')
  assertStringIncludes(err.message, 'KNOCK_TEST_MISSING_TOKEN')
})

test('R03 loadConfig: 加载成功和失败都应记录结构化日志', async () => {
  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'config.load',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })

  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
sources: {}
`,
  )
  await loadConfig({ runtimeDir: TEST_RUNTIME, logger })

  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
sources:
  broken:
    syndication:
      entry:
        id: "{{ id }}"
`,
  )
  await assertRejects(() => loadConfig({ runtimeDir: TEST_RUNTIME, logger }), Error)

  const output = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'config.load' &&
        attributes['config.operation'] === 'load_config' &&
        attributes['config.outcome'] === 'start'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'config.load' &&
        attributes['config.operation'] === 'load_config' &&
        attributes['config.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'config.validate' &&
        attributes['config.operation'] === 'validate_config' &&
        attributes['config.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'config.resolve' &&
        attributes['config.operation'] === 'resolve_config' &&
        attributes['config.outcome'] === 'success'
      )
    }),
    true,
  )
  assertEquals(
    output.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'config.load' &&
        attributes['config.operation'] === 'load_config' &&
        attributes['config.outcome'] === 'failure'
      )
    }),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        typeof ((item.attributes ?? {}) as Record<string, unknown>)['config.path'] === 'string',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        typeof ((item.attributes ?? {}) as Record<string, unknown>)['config.runtime_dir'] ===
        'string',
    ),
    true,
  )
  assertEquals(
    output.some((item) => 'operation' in ((item.attributes ?? {}) as Record<string, unknown>)),
    false,
  )
  assertEquals(
    output.some((item) => 'outcome' in ((item.attributes ?? {}) as Record<string, unknown>)),
    false,
  )
  assertEquals(
    output.some((item) => 'config_path' in ((item.attributes ?? {}) as Record<string, unknown>)),
    false,
  )
  assertEquals(
    output.some((item) => 'runtime_dir' in ((item.attributes ?? {}) as Record<string, unknown>)),
    false,
  )
})

test('loadConfig: 应递归展开 email 配置中的环境变量字符串', async () => {
  Deno.env.set('KNOCK_TEST_SMTP_HOST', 'smtp.example.com')
  Deno.env.set('KNOCK_TEST_SMTP_USER', 'mailer')
  Deno.env.set('KNOCK_TEST_SMTP_PASS', 'secret')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
deliveries:
  release_email:
    email:
      smtp:
        host: ${'${KNOCK_TEST_SMTP_HOST}'}
        port: 587
        security: starttls
        auth:
          username: ${'${KNOCK_TEST_SMTP_USER}'}
          password: ${'${KNOCK_TEST_SMTP_PASS}'}
      message:
        from: bot@example.com
        to:
          - team@example.com
        subject: hello
        text: world

sources: {}
`,
    )

    const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
    const delivery = config.deliveries.find((item) => item.id === 'release_email')
    assertEquals(delivery?.email?.smtp.host, 'smtp.example.com')
    assertEquals(delivery?.email?.smtp.auth?.username, 'mailer')
    assertEquals(delivery?.email?.smtp.auth?.password, 'secret')
  } finally {
    Deno.env.delete('KNOCK_TEST_SMTP_HOST')
    Deno.env.delete('KNOCK_TEST_SMTP_USER')
    Deno.env.delete('KNOCK_TEST_SMTP_PASS')
  }
})

test('loadConfig: summary.feed 与 summary.entry 中允许环境变量展开，与 capability 保持一致', async () => {
  Deno.env.set('KNOCK_TEST_SUMMARY_TITLE', 'Daily Summary From Env')
  Deno.env.set('KNOCK_TEST_SUMMARY_DESC_PREFIX', '窗口')
  Deno.env.set('KNOCK_TEST_SUMMARY_ENTRY_TITLE', 'Deno Daily')
  Deno.env.set('KNOCK_TEST_SUMMARY_ENTRY_ID_PREFIX', 'summary-window')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
deliveries:
  local:
    file:
      path: outputs/summary.md
      content: '{{ entry.title }}'

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      local: {}
  daily_summary:
    schedule: '0 0 8 * * *'
    deliveries:
      local: {}
    summary:
      sources:
        - deno
      feed:
        title: ${'${KNOCK_TEST_SUMMARY_TITLE}'}
        description: '${'${KNOCK_TEST_SUMMARY_DESC_PREFIX}'}: {{ source.runtime.window.scheduledAt }}'
      entry:
        id: '${'${KNOCK_TEST_SUMMARY_ENTRY_ID_PREFIX}'}:{{ source.runtime.window.scheduledAt }}'
        title: '${'${KNOCK_TEST_SUMMARY_ENTRY_TITLE}'} {{ sources.deno.name }}'

`,
    )

    const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
    const summarySource = config.sources.find((source) => source.id === 'daily_summary')

    assertEquals(summarySource?.summary?.feed, {
      title: 'Daily Summary From Env',
      description: '窗口: {{ source.runtime.window.scheduledAt }}',
    })
    assertEquals(summarySource?.summary?.entry, {
      id: 'summary-window:{{ source.runtime.window.scheduledAt }}',
      title: 'Deno Daily {{ sources.deno.name }}',
    })
  } finally {
    Deno.env.delete('KNOCK_TEST_SUMMARY_TITLE')
    Deno.env.delete('KNOCK_TEST_SUMMARY_DESC_PREFIX')
    Deno.env.delete('KNOCK_TEST_SUMMARY_ENTRY_TITLE')
    Deno.env.delete('KNOCK_TEST_SUMMARY_ENTRY_ID_PREFIX')
  }
})

test('loadConfig: AI defaultModel 禁止环境变量展开，与 validateConfig 保持一致', async () => {
  Deno.env.set('KNOCK_TEST_DEFAULT_MODEL', 'main/mini')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
ai:
  defaultModel: ${'${KNOCK_TEST_DEFAULT_MODEL}'}
  providers:
    main:
      type: openai
      models:
        mini:
          model: gpt-4o-mini

sources: {}
`,
    )

    const err = await assertRejects(() => loadConfig({ runtimeDir: TEST_RUNTIME }), Error)
    assertStringIncludes(err.message, 'ai.defaultModel 不支持环境变量展开')
  } finally {
    Deno.env.delete('KNOCK_TEST_DEFAULT_MODEL')
  }
})

test('loadConfig: provider-specific options 允许 ENV 但不允许 Liquid，与 validateConfig 保持一致', async () => {
  Deno.env.set('KNOCK_TEST_OPENAI_ORG', 'org-demo')
  Deno.env.set('KNOCK_TEST_OPENAI_PROJECT', 'proj-demo')
  Deno.env.set('KNOCK_TEST_ANTHROPIC_AUTH', 'anthropic-token')

  try {
    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
ai:
  providers:
    openai_main:
      type: openai
      options:
        organization: ${'${KNOCK_TEST_OPENAI_ORG}'}
        project: ${'${KNOCK_TEST_OPENAI_PROJECT}'}
      models:
        mini:
          model: gpt-4o-mini
    claude:
      type: anthropic
      options:
        authToken: ${'${KNOCK_TEST_ANTHROPIC_AUTH}'}
      models:
        sonnet:
          model: claude-3-7-sonnet-latest

sources: {}
`,
    )

    const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
    const openaiProvider = config.ai?.providers.find((provider) => provider.id === 'openai_main')
    const anthropicProvider = config.ai?.providers.find((provider) => provider.id === 'claude')

    assertEquals(openaiProvider?.options, {
      organization: 'org-demo',
      project: 'proj-demo',
    })
    assertEquals(anthropicProvider?.options, {
      authToken: 'anthropic-token',
    })

    await Deno.writeTextFile(
      join(TEST_RUNTIME, 'config.yml'),
      `
ai:
  providers:
    openai_main:
      type: openai
      options:
        organization: "{{ entry.title }}"
      models:
        mini:
          model: gpt-4o-mini

sources: {}
`,
    )

    const err = await assertRejects(() => loadConfig({ runtimeDir: TEST_RUNTIME }), Error)
    assertStringIncludes(
      err.message,
      'ai.providers.openai_main.options.organization 配置非法: ai.providers.*.options.organization 不支持 Liquid 模板',
    )
  } finally {
    Deno.env.delete('KNOCK_TEST_OPENAI_ORG')
    Deno.env.delete('KNOCK_TEST_OPENAI_PROJECT')
    Deno.env.delete('KNOCK_TEST_ANTHROPIC_AUTH')
  }
})

test('loadConfig: configPath 应派生 runtimeDir 并解析相对路径', async () => {
  const nestedRuntime = join(TEST_RUNTIME, 'nested-runtime')
  await Deno.mkdir(nestedRuntime, { recursive: true })
  const configPath = join(nestedRuntime, 'custom.yml')

  await Deno.writeTextFile(
    configPath,
    `
logging:
  level: info
  sinks:
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
`,
  )

  const config = await loadConfig({ configPath })
  assertEquals(config.runtimeDir, nestedRuntime)
  assertEquals(config.logging.sinks.file?.path, join(nestedRuntime, 'logs', 'app.jsonl'))
})

test('loadConfig: 显式 runtimeDir 应优先于 KNOCK_RUNTIME_DIR 与 configPath 派生目录', async () => {
  const explicitRuntime = join(TEST_RUNTIME, 'explicit-runtime')
  const envRuntime = join(TEST_RUNTIME, 'env-runtime')
  const otherDir = join(TEST_RUNTIME, 'other-dir')
  await Deno.mkdir(explicitRuntime, { recursive: true })
  await Deno.mkdir(envRuntime, { recursive: true })
  await Deno.mkdir(otherDir, { recursive: true })

  const configPath = join(otherDir, 'custom.yml')
  const previousRuntimeDir = Deno.env.get('KNOCK_RUNTIME_DIR')
  Deno.env.set('KNOCK_RUNTIME_DIR', envRuntime)

  try {
    await Deno.writeTextFile(
      configPath,
      `
logging:
  level: info
  sinks:
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
`,
    )

    const config = await loadConfig({
      runtimeDir: explicitRuntime,
      configPath,
    })
    assertEquals(config.runtimeDir, explicitRuntime)
    assertEquals(config.logging.sinks.file?.path, join(explicitRuntime, 'logs', 'app.jsonl'))
  } finally {
    if (previousRuntimeDir === undefined) {
      Deno.env.delete('KNOCK_RUNTIME_DIR')
    } else {
      Deno.env.set('KNOCK_RUNTIME_DIR', previousRuntimeDir)
    }
  }
})

test('loadConfig: 应支持 config.yaml fallback', async () => {
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yaml'),
    `
logging:
  level: info
  sinks:
    file:
      type: file
      format: jsonl
      path: logs/fallback.jsonl
`,
  )

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(config.logging.sinks.file?.path, join(TEST_RUNTIME, 'logs', 'fallback.jsonl'))
})

test('loadCompiledConfig: 应返回统一编译结果契约', async () => {
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
deliveries:
  archive:
    file:
      path: outputs/archive.md
      content: '{{ entry.title }}'

sources:
  rust:
    http:
      url: https://example.com/feed.xml
    syndication: {}
    deliveries:
      archive: {}
`,
  )

  const loaded = await loadCompiledConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(loaded.runtimeDir, TEST_RUNTIME)
  assertEquals(loaded.configPath, join(TEST_RUNTIME, 'config.yml'))
  assertEquals(loaded.diagnostics, [])
  assertEquals(loaded.config.sources[0]?.id, 'rust')
  assertEquals(loaded.definitions.sources[0]?.sourceId, 'rust')
  assertEquals(loaded.definitions.bindings[0]?.deliveryId, 'archive')
})

test('loadConfig: README HTTP 文档应保持 canonical 形态并拒绝 legacy 回流', async () => {
  const readme = await Deno.readTextFile(README_PATH)

  assertStringIncludes(readme, '## 完整键索引')
  assertStringIncludes(readme, '### `deliveries` 键路径')
  assertStringIncludes(readme, 'deliveries.<deliveryId>.push.http.url')
  assertStringIncludes(readme, 'deliveries.<deliveryId>.push.request.type')
  assertStringIncludes(readme, 'deliveries.<deliveryId>.email.smtp.host')
  assertStringIncludes(readme, 'deliveries.<deliveryId>.email.message.from')
  assertStringIncludes(readme, '### `sources` 键路径')
  assertStringIncludes(readme, 'sources.<sourceId>.http.url')
  assertStringIncludes(readme, 'sources.<sourceId>.byparr.endpoint')
  assertStringIncludes(readme, 'sources.<sourceId>.byparr.url')
  assertStringIncludes(readme, 'webhook:\n    push:\n      http:')
  assertStringIncludes(readme, '  release_email:\n    email:\n      smtp:')
  assertStringIncludes(readme, 'sources:\n  deno:\n    http:\n      url:')

  assertEquals(readme.includes('push.http.type'), false)
  assertEquals(readme.includes('push.http.payload'), false)
  assertEquals(readme.includes('deliveries.<id>.http'), false)
  assertEquals(readme.includes('sources.<id>.url'), false)
  assertEquals(readme.includes('sources:\n  deno:\n    url:'), false)
  assertEquals(readme.includes('webhook:\n    http:'), false)
})
