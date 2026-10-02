import { assertEquals, assertRejects, assertStringIncludes } from '../testing/assert.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '../core/logger.ts'
import { mkdirPath } from '../platform/fs.ts'
import { test as registerTest } from '../testing/test_api.ts'
import {
  withEnv,
  withRuntimeHarness,
  writeRuntimeFile,
  writeTextFile,
} from '../testing/test_helpers.ts'
import {
  compileConfigDocument,
  loadCompiledConfig,
  toConfigLoadError,
} from './load_compiled_config.ts'
import { loadConfig } from './load_config.ts'

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const TEST_RUNTIME = join(PROJECT_ROOT, '.tmp', 'runtime-load-config')

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withRuntimeHarness(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

test('loadConfig: 应递归展开配置中的环境变量字符串', async () => {
  await withEnv(
    {
      KNOCK_TEST_WEBHOOK_URL: 'https://example.com/webhook',
      KNOCK_TEST_WEBHOOK_TOKEN: 'env-token',
      KNOCK_TEST_SOURCE_URL: 'https://example.com/feed.xml',
      KNOCK_TEST_FILE_PATH: 'outputs/feed.md',
    },
    async () => {
      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
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
    },
  )
})

test('loadConfig: 支持环境变量展开的 email.from 应成功展开', async () => {
  await withEnv({ KNOCK_TEST_EMAIL_URL: 'https://example.com/template' }, async () => {
    await writeRuntimeFile(
      TEST_RUNTIME,
      'config.yml',
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
  })
})

test('loadConfig: 应解析 logging file sink 与 time rotation', async () => {
  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
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
  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
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

test('loadCompiledConfig: source.deliveries 数组输入应按当前对象契约拒绝', async () => {
  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
    `
deliveries:
  webhook:
    push:
      http:
        url: https://example.com/hook

sources:
  rust:
    http:
      url: https://example.com/feed.xml
    deliveries:
      - webhook
`,
  )

  const err = await assertRejects(() => loadCompiledConfig({ runtimeDir: TEST_RUNTIME }), Error)
  assertStringIncludes(err.message, 'source.rust.deliveries')
  assertStringIncludes(err.message, '必须是对象')
})

test('R04 loadConfig: 缺失环境变量时应报出配置路径', async () => {
  await withEnv({ KNOCK_TEST_MISSING_TOKEN: undefined }, async () => {
    await writeRuntimeFile(
      TEST_RUNTIME,
      'config.yml',
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

  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
    `
sources: {}
`,
  )
  await loadConfig({ runtimeDir: TEST_RUNTIME, logger })

  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
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
  await withEnv(
    {
      KNOCK_TEST_SMTP_HOST: 'smtp.example.com',
      KNOCK_TEST_SMTP_USER: 'mailer',
      KNOCK_TEST_SMTP_PASS: 'secret',
    },
    async () => {
      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
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
    },
  )
})

test('loadConfig: summary.feed 与 summary.entry 中允许环境变量展开，与 capability 保持一致', async () => {
  await withEnv(
    {
      KNOCK_TEST_SUMMARY_TITLE: 'Daily Summary From Env',
      KNOCK_TEST_SUMMARY_DESC_PREFIX: '窗口',
      KNOCK_TEST_SUMMARY_ENTRY_TITLE: 'Bun Daily',
      KNOCK_TEST_SUMMARY_ENTRY_ID_PREFIX: 'summary-window',
    },
    async () => {
      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
        `
deliveries:
  local:
    file:
      path: outputs/summary.md
      content: '{{ entry.title }}'

sources:
  bun:
    http:
      url: https://github.com/oven-sh/bun/releases.atom
    deliveries:
      local: {}
  daily_summary:
    schedule: '0 0 8 * * *'
    deliveries:
      local: {}
    summary:
      sources:
        - bun
      feed:
        title: ${'${KNOCK_TEST_SUMMARY_TITLE}'}
        description: '${'${KNOCK_TEST_SUMMARY_DESC_PREFIX}'}: {{ source.runtime.window.scheduledAt }}'
      entry:
        id: '${'${KNOCK_TEST_SUMMARY_ENTRY_ID_PREFIX}'}:{{ source.runtime.window.scheduledAt }}'
        title: '${'${KNOCK_TEST_SUMMARY_ENTRY_TITLE}'} {{ sources.bun.name }}'

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
        title: 'Bun Daily {{ sources.bun.name }}',
      })
    },
  )
})

test('loadConfig: AI defaultModel 禁止环境变量展开，与 validateConfig 保持一致', async () => {
  await withEnv({ KNOCK_TEST_DEFAULT_MODEL: 'main/mini' }, async () => {
    await writeRuntimeFile(
      TEST_RUNTIME,
      'config.yml',
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
  })
})

test('loadConfig: provider-specific options 允许 ENV 但不允许 Liquid，与 validateConfig 保持一致', async () => {
  await withEnv(
    {
      KNOCK_TEST_OPENAI_ORG: 'org-demo',
      KNOCK_TEST_OPENAI_PROJECT: 'proj-demo',
      KNOCK_TEST_ANTHROPIC_AUTH: 'anthropic-token',
    },
    async () => {
      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
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

      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
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
    },
  )
})

test('loadConfig: configPath 应派生 runtimeDir 并解析相对路径', async () => {
  const nestedRuntime = join(TEST_RUNTIME, 'nested-runtime')
  await mkdirPath(nestedRuntime, { recursive: true })
  const configPath = join(nestedRuntime, 'custom.yml')

  await writeTextFile(
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
  await mkdirPath(explicitRuntime, { recursive: true })
  await mkdirPath(envRuntime, { recursive: true })
  await mkdirPath(otherDir, { recursive: true })

  const configPath = join(otherDir, 'custom.yml')

  await withEnv({ KNOCK_RUNTIME_DIR: envRuntime }, async () => {
    await writeTextFile(
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
  })
})

test('loadConfig: EACCES 时应补充容器 bind mount 排查提示', () => {
  const configPath = '/app/runtime/config.yml'
  const runtimeDir = '/app/runtime'
  const error = Object.assign(new Error(`EACCES: permission denied, open '${configPath}'`), {
    code: 'EACCES',
  })

  const wrapped = toConfigLoadError(configPath, runtimeDir, error)

  assertStringIncludes(wrapped.message, `配置文件错误(${configPath}): EACCES: permission denied`)
  assertStringIncludes(wrapped.message, 'Docker bind mount')
  assertStringIncludes(wrapped.message, '非 root 用户 knock')
  assertStringIncludes(wrapped.message, '--user "$(id -u):$(id -g)"')
})

test('loadConfig: 非权限错误应保持原始错误文案', () => {
  const wrapped = toConfigLoadError('/tmp/config.yml', '/tmp', new Error('配置非法'))
  assertEquals(wrapped.message, '配置文件错误(/tmp/config.yml): 配置非法')
})

test('loadConfig: 缺失 config.yml 时应读取 config.yaml', async () => {
  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yaml',
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

test('compileConfigDocument: 应保留 preserve_unknown 语义并返回统一编译结果', () => {
  return withEnv(
    {
      KNOCK_TEST_COMPILED_SOURCE_URL: 'https://example.com/feed.xml',
      KNOCK_TEST_COMPILED_TOKEN: 'env-token',
      KNOCK_TEST_COMPILED_MISSING: undefined,
    },
    () => {
      const compiled = compileConfigDocument({
        runtimeDir: TEST_RUNTIME,
        configPath: join(TEST_RUNTIME, 'config.yml'),
        envMode: 'preserve_unknown',
        document: {
          deliveries: {
            archive: {
              file: {
                path: 'outputs/archive.md',
                content: '{{ entry.title }}',
              },
            },
            webhook: {
              push: {
                http: {
                  url: 'https://example.com/webhook',
                },
                request: {
                  type: 'body',
                  payload: {
                    token: '${KNOCK_TEST_COMPILED_TOKEN}',
                    missing: '${KNOCK_TEST_COMPILED_MISSING}',
                  },
                },
              },
            },
          },
          sources: {
            rust: {
              http: {
                url: '${KNOCK_TEST_COMPILED_SOURCE_URL}',
              },
              syndication: {},
              deliveries: {
                archive: {},
                webhook: {},
              },
            },
          },
        },
      })

      assertEquals(compiled.runtimeDir, TEST_RUNTIME)
      assertEquals(compiled.configPath, join(TEST_RUNTIME, 'config.yml'))
      assertEquals(compiled.config.sources[0]?.http?.url, 'https://example.com/feed.xml')
      assertEquals(compiled.config.deliveries[1]?.push?.request.payload, {
        token: 'env-token',
        missing: '${KNOCK_TEST_COMPILED_MISSING}',
      })
      assertEquals(compiled.definitions.sources[0]?.sourceId, 'rust')
      assertEquals(compiled.definitions.bindings.length, 2)
    },
  )
})

test('loadCompiledConfig: 应返回统一编译结果契约', async () => {
  await writeRuntimeFile(
    TEST_RUNTIME,
    'config.yml',
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

test('loadCompiledConfig: ai.providers.*.baseURL 展开为带引号 URL 时应在加载期失败', async () => {
  await withEnv(
    {
      KNOCK_TEST_AI_BASE_URL: '"https://ap.904527.xyz/v1"',
    },
    async () => {
      await writeRuntimeFile(
        TEST_RUNTIME,
        'config.yml',
        `
ai:
  providers:
    main:
      type: openai
      baseURL: ${'${KNOCK_TEST_AI_BASE_URL}'}
      models:
        default:
          model: gpt-4o-mini

sources: {}
`,
      )

      const err = await assertRejects(() => loadCompiledConfig({ runtimeDir: TEST_RUNTIME }), Error)
      assertStringIncludes(err.message, 'ai.providers.main.baseURL 配置非法')
      assertStringIncludes(err.message, '"https://ap.904527.xyz/v1"')
    },
  )
})
export const testMeta = [
  {
    title: 'R04 loadConfig: 缺失环境变量时应报出配置路径',
    layer: 'contract',
    risks: ['R04'],
  },
  {
    title: 'R03 loadConfig: 加载成功和失败都应记录结构化日志',
    layer: 'contract',
    risks: ['R03'],
  },
] as const
