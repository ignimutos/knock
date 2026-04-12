import { assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import type { ResolvedSourceConfig } from '../config/types.ts'
import { createAiRuntime } from '../core/ai_runtime.ts'
import { getAiEntryRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createDbClient } from '../db/client.ts'
import { createSourceStateQuery } from '../db/source_state_query.ts'
import { createSourceStateStore } from '../db/source_state_store.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { buildSummarySource } from './summary.ts'

const TEST_RUNTIME = join(Deno.cwd(), '.tmp', 'runtime-summary-source')

const registerTest = Deno.test

function test(name: string, fn: () => Promise<void> | void): void {
  registerTest(name, async () => {
    await withOwnedRuntime(TEST_RUNTIME, async () => {
      await fn()
    })
  })
}

function createSqliteConfig(databaseName: string) {
  return {
    path: join(TEST_RUNTIME, databaseName),
    busyTimeout: '5s',
    journalMode: 'WAL' as const,
    retention: {
      maxAge: '1d',
      maxEntriesPerSource: 20,
      vacuum: 'off' as const,
    },
  }
}

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

function createSummarySource(overrides: Partial<ResolvedSourceConfig> = {}): ResolvedSourceConfig {
  return {
    id: 'summary.daily',
    name: 'Daily Summary',
    enabled: true,
    deliveries: [],
    summary: {
      sources: ['rust', 'deno'],
    },
    ...overrides,
  }
}

test('summarySource: 首次运行无 checkpoint 时应忽略模板覆写并返回默认 feed、空 entries 与 observedAt', async () => {
  const sqlite = createSqliteConfig('summary-first-run.db')
  const db = createDbClient({ sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const contentRuntime = createContentRuntime()
  const scheduledAt = '2026-04-12T10:00:00.000Z'

  const result = await buildSummarySource({
    source: createSummarySource({
      summary: {
        sources: ['rust', 'deno'],
        feed: {
          title: 'Overridden title',
          description: '{{ source.id }}',
        },
        entry: {
          id: 'entry-override',
          title: '{{ source.id }}',
        },
      },
    }),
    scheduledAt,
    language: 'en-US',
    stateQuery,
    contentRuntime,
  })

  assertEquals(result.parser, 'summary')
  assertEquals(result.observedAt, scheduledAt)
  assertEquals(result.feedMapped, {
    title: 'Daily Summary',
    link: '',
    description: '',
    generator: 'knock.summary',
    language: 'en-US',
    published: scheduledAt,
  })
  assertEquals(result.entries, [])
  assertEquals(
    result.payload,
    JSON.stringify({
      kind: 'summary',
      sourceId: 'summary.daily',
      sourceIds: ['rust', 'deno'],
      previousCheckpoint: null,
      scheduledAt,
    }),
  )

  db.$client.close()
})

test('summarySource: 有 checkpoint 时模板可访问完整上下文字段', async () => {
  const sqlite = createSqliteConfig('summary-template-context.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const contentRuntime = createContentRuntime()

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'summary',
    payload: 'old-summary',
    feedMapped: { title: 'Yesterday Summary' },
    entries: [],
    observedAt: '2026-04-11T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Rust Feed', description: 'Rust Feed Description' },
    entries: [
      { mapped: { id: 'rust-1', title: 'Rust Entry 1', description: 'Rust Entry 1 Description' } },
      { mapped: { id: 'rust-2', title: 'Rust Entry 2' } },
    ],
    observedAt: '2026-04-12T08:00:00.000Z',
  })

  const scheduledAt = '2026-04-12T10:00:00.000Z'
  const result = await buildSummarySource({
    source: createSummarySource({
      summary: {
        sources: ['rust'],
        feed: {
          title:
            '{{ source.id }}|{{ source.runtime.window.scheduledAt }}|{{ feed.title }}|{{ entry.id }}|{{ sources.rust.name }}|{{ sources.rust.feed.title }}',
        },
        entry: {
          id: '{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}',
          title:
            '{{ source.id }}|{{ source.runtime.window.scheduledAt }}|{{ feed.title }}|{{ entry.id }}|{{ sources.rust.name }}|{{ sources.rust.feed.title }}|{{ sources.rust.entries[0].title }}',
          description:
            '{{ source.name }}|{{ feed.generator }}|{{ entry.title }}|{{ sources.rust.feed.description }}|{{ sources.rust.entries[0].description }}',
        },
      },
    }),
    scheduledAt,
    language: 'en-US',
    stateQuery,
    contentRuntime,
  })

  assertEquals(
    result.feedMapped.title,
    'summary.daily|2026-04-12T10:00:00.000Z|Daily Summary|summary.daily:2026-04-11T09:00:00.000Z..2026-04-12T10:00:00.000Z|Rust Feed|Rust Feed',
  )
  assertEquals(result.entries.length, 1)
  assertEquals(result.entries[0].mapped.id, '2026-04-11T09:00:00.000Z..2026-04-12T10:00:00.000Z')
  assertEquals(
    result.entries[0].mapped.title,
    'summary.daily|2026-04-12T10:00:00.000Z|summary.daily|2026-04-12T10:00:00.000Z|Daily Summary|summary.daily:2026-04-11T09:00:00.000Z..2026-04-12T10:00:00.000Z|Rust Feed|Rust Feed|summary.daily:2026-04-11T09:00:00.000Z..2026-04-12T10:00:00.000Z|Rust Feed|Rust Feed|Rust Entry 1',
  )
  assertEquals(
    result.entries[0].mapped.description,
    'Daily Summary|knock.summary|Daily Summary|Rust Feed Description|Rust Entry 1 Description',
  )

  db.$client.close()
})

test('summarySource: summary feed 模板中的 ai_summarize 应可工作', async () => {
  const sqlite = createSqliteConfig('summary-feed-ai-template.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const aiRequests: Array<Record<string, unknown>> = []
  const aiRuntime = createTestAiRuntime((input) => {
    aiRequests.push(input)
    return Promise.resolve({ text: 'AI Feed Summary' })
  })
  const contentRuntime = createContentRuntime({ aiRuntime })

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'summary',
    payload: 'old-summary',
    feedMapped: { title: 'Yesterday Summary' },
    entries: [],
    observedAt: '2026-04-11T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Rust Feed' },
    entries: [{ mapped: { id: 'rust-1', title: 'Rust Entry 1' } }],
    observedAt: '2026-04-12T08:00:00.000Z',
  })

  const result = await buildSummarySource({
    source: createSummarySource({
      summary: {
        sources: ['rust'],
        feed: {
          description: '{{ sources.rust.entries[0].title | ai_summarize }}',
        },
      },
    }),
    scheduledAt: '2026-04-12T10:00:00.000Z',
    language: 'en-US',
    stateQuery,
    contentRuntime,
  })

  assertEquals(result.feedMapped.description, 'AI Feed Summary')
  assertEquals(result.entries.length, 1)
  assertEquals(aiRequests.length, 1)
  assertEquals(
    getAiEntryRuntime(result.entries[0].mapped as Record<PropertyKey, unknown>),
    undefined,
  )

  db.$client.close()
})

test('summarySource: summary entry 模板中的 ai_summarize 应可工作', async () => {
  const sqlite = createSqliteConfig('summary-ai-template.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const aiRequests: Array<Record<string, unknown>> = []
  const aiRuntime = createTestAiRuntime((input) => {
    aiRequests.push(input)
    return Promise.resolve({ text: 'AI Summary' })
  })
  const contentRuntime = createContentRuntime({ aiRuntime })

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'summary',
    payload: 'old-summary',
    feedMapped: { title: 'Yesterday Summary' },
    entries: [],
    observedAt: '2026-04-11T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Rust Feed' },
    entries: [{ mapped: { id: 'rust-1', title: 'Rust Entry 1' } }],
    observedAt: '2026-04-12T08:00:00.000Z',
  })

  const result = await buildSummarySource({
    source: createSummarySource({
      summary: {
        sources: ['rust'],
        entry: {
          id: '{{ entry.id }}',
          description: '{{ sources.rust.entries[0].title | ai_summarize }}',
        },
      },
    }),
    scheduledAt: '2026-04-12T10:00:00.000Z',
    language: 'en-US',
    stateQuery,
    contentRuntime,
  })

  assertEquals(result.entries.length, 1)
  assertEquals(result.entries[0].mapped.description, 'AI Summary')
  assertEquals(aiRequests.length, 1)
  assertEquals(
    getAiEntryRuntime(result.entries[0].mapped as Record<PropertyKey, unknown>),
    undefined,
  )

  db.$client.close()
})

test('summarySource: 仅传带 AI 的 contentRuntime 时 ai_summarize 也应可工作', async () => {
  const sqlite = createSqliteConfig('summary-ai-template-content-runtime-only.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const aiRequests: Array<Record<string, unknown>> = []
  const aiRuntime = createTestAiRuntime((input) => {
    aiRequests.push(input)
    return Promise.resolve({ text: 'AI Summary from Content Runtime' })
  })
  const contentRuntime = createContentRuntime({ aiRuntime })

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'summary',
    payload: 'old-summary',
    feedMapped: { title: 'Yesterday Summary' },
    entries: [],
    observedAt: '2026-04-11T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Rust Feed' },
    entries: [{ mapped: { id: 'rust-1', title: 'Rust Entry 1' } }],
    observedAt: '2026-04-12T08:00:00.000Z',
  })

  const result = await buildSummarySource({
    source: createSummarySource({
      summary: {
        sources: ['rust'],
        entry: {
          id: '{{ entry.id }}',
          description: '{{ sources.rust.entries[0].title | ai_summarize }}',
        },
      },
    }),
    scheduledAt: '2026-04-12T10:00:00.000Z',
    language: 'en-US',
    stateQuery,
    contentRuntime,
  })

  assertEquals(result.entries.length, 1)
  assertEquals(result.entries[0].mapped.description, 'AI Summary from Content Runtime')
  assertEquals(aiRequests.length, 1)
  assertEquals(
    getAiEntryRuntime(result.entries[0].mapped as Record<PropertyKey, unknown>),
    undefined,
  )

  db.$client.close()
})

test('summarySource: 缺少 contentRuntime ai 支持时 ai_summarize 错误应上抛', async () => {
  const sqlite = createSqliteConfig('summary-ai-missing-runtime.db')
  const db = createDbClient({ sqlite })
  const store = createSourceStateStore({ db, sqlite })
  const stateQuery = createSourceStateQuery({ db })
  const contentRuntime = createContentRuntime()

  await store.persistParsedSource({
    sourceId: 'summary.daily',
    parser: 'summary',
    payload: 'old-summary',
    feedMapped: { title: 'Yesterday Summary' },
    entries: [],
    observedAt: '2026-04-11T09:00:00.000Z',
  })

  await store.persistParsedSource({
    sourceId: 'rust',
    parser: 'rss',
    payload: '<rss></rss>',
    feedMapped: { title: 'Rust Feed' },
    entries: [{ mapped: { id: 'rust-1', title: 'Rust Entry 1' } }],
    observedAt: '2026-04-12T08:00:00.000Z',
  })

  await assertRejects(
    () =>
      buildSummarySource({
        source: createSummarySource({
          summary: {
            sources: ['rust'],
            entry: {
              id: '{{ entry.id }}',
              description: '{{ sources.rust.entries[0].title | ai_summarize }}',
            },
          },
        }),
        scheduledAt: '2026-04-12T10:00:00.000Z',
        language: 'en-US',
        stateQuery,
        contentRuntime,
      }),
    Error,
    '未配置 ai，无法使用 ai_summarize',
  )

  db.$client.close()
})
