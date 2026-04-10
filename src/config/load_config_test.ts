import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { emptyDir, ensureDir } from '@std/fs'
import { dirname, fromFileUrl, join } from '@std/path'
import { createLogger } from '../core/logger.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { loadConfig } from './load_config.ts'

const PROJECT_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))))
const TEST_RUNTIME = join(PROJECT_ROOT, '.tmp', 'runtime-load-config')
const README_PATH = join(PROJECT_ROOT, 'README.md')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('loadConfig: 应递归展开配置中的环境变量字符串', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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
      - webhook
      - archive
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
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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

test('loadConfig: 缺失环境变量时应报出配置路径', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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

test('loadConfig: 加载成功和失败都应记录结构化日志', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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
    output.some(
      (item) =>
        item.module === 'config.load' &&
        item.operation === 'load_config' &&
        item.outcome === 'start',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.module === 'config.load' &&
        item.operation === 'load_config' &&
        item.outcome === 'success',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.module === 'config.validate' &&
        item.operation === 'validate_config' &&
        item.outcome === 'success',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.module === 'config.resolve' &&
        item.operation === 'resolve_config' &&
        item.outcome === 'success',
    ),
    true,
  )
  assertEquals(
    output.some(
      (item) =>
        item.module === 'config.load' &&
        item.operation === 'load_config' &&
        item.outcome === 'failure',
    ),
    true,
  )
  assertEquals(
    output.some((item) => typeof item.config_path === 'string'),
    true,
  )
  assertEquals(
    output.some((item) => typeof item.runtime_dir === 'string'),
    true,
  )
})

test('loadConfig: 应递归展开 email 配置中的环境变量字符串', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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

test('loadConfig: AI defaultModel 禁止环境变量展开，与 validateConfig 保持一致', async () => {
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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
  await emptyDir(TEST_RUNTIME)
  await ensureDir(TEST_RUNTIME)

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

test('loadConfig: README HTTP 文档应保持 canonical 形态并拒绝 legacy 回流', async () => {
  const readme = await Deno.readTextFile(README_PATH)

  assertStringIncludes(readme, '### 2) HTTP 投递：`deliveries.<id>.push`')
  assertStringIncludes(readme, '#### `push.http.url`')
  assertStringIncludes(readme, '#### `push.request.type`')
  assertStringIncludes(readme, '### 3) SMTP 邮件投递：`deliveries.<id>.email`')
  assertStringIncludes(readme, '#### `email.smtp.host`')
  assertStringIncludes(readme, '#### `email.message.*`')
  assertStringIncludes(readme, '### 4) Source HTTP transport：`sources.<id>.http`')
  assertStringIncludes(readme, '### 6) Source Byparr transport：`sources.<id>.byparr`')
  assertStringIncludes(readme, 'webhook:\n    push:\n      http:')
  assertStringIncludes(readme, '  release_email:\n    email:\n      smtp:')
  assertStringIncludes(readme, 'sources:\n  deno:\n    http:\n      url:')

  assertEquals(readme.includes('deliveries.<id>.push.http`'), false)
  assertEquals(readme.includes('push.http.type'), false)
  assertEquals(readme.includes('push.http.payload'), false)
  assertEquals(readme.includes('deliveries.<id>.http'), false)
  assertEquals(readme.includes('sources.<id>.url'), false)
  assertEquals(readme.includes('sources:\n  deno:\n    url:'), false)
  assertEquals(readme.includes('webhook:\n    http:'), false)
})
