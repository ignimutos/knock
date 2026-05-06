import { assertEquals, assertStringIncludes } from '../testing/assert.ts'
import { join } from 'node:path'
import type { ResolvedSourceConfig } from '../config/types.ts'
import { createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { createDbClient } from '../db/client.ts'
import {
  insertSourceRun,
  setSourceRunFeedSnapshot,
} from '../infrastructure/sqlite/run_repository.ts'
import { createSummaryQueryService } from '../infrastructure/sqlite/summary_query_service.ts'
import { insertPipelineItem } from '../infrastructure/sqlite/item_repository.ts'
import { cwd } from '../platform/fs.ts'
import { withOwnedRuntime } from '../test_runtime.ts'
import { buildSummarySource } from './summary.ts'
import { test } from '../testing/test_api.ts'

// risk-id: R17
// layer: contract

const TEST_RUNTIME = join(cwd(), '.tmp', 'runtime-summary-source')

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

function createSummarySource(overrides: Partial<ResolvedSourceConfig> = {}): ResolvedSourceConfig {
  return {
    id: 'summary.daily',
    name: 'Daily Summary',
    enabled: true,
    deliveries: [],
    summary: {
      sources: ['rust'],
    },
    ...overrides,
  }
}

test('[contract] summarySource: 首次运行无 checkpoint 时应返回默认 feed 与空 entries', async () => {
  await withOwnedRuntime(TEST_RUNTIME, async () => {
    const db = createDbClient({ sqlite: createSqliteConfig('summary-first-run.db') })
    const summaryQueryService = createSummaryQueryService(db)
    const contentRuntime = createContentRuntime()
    const scheduledAt = '2026-04-12T10:00:00.000Z'

    const result = await buildSummarySource({
      source: createSummarySource({
        summary: {
          sources: ['rust'],
          feed: { title: 'ignored' },
          entry: { id: 'ignored' },
        },
      }),
      upstreamSourceIds: ['rust'],
      scheduledAt,
      language: 'en-US',
      effectDomain: 'production',
      summaryQueryService,
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
        sourceIds: ['rust'],
        previousCheckpoint: null,
        scheduledAt,
      }),
    )

    db.$client.close()
  })
})

test('[flow] R17 summarySource: 有 checkpoint 时应从 v2 facts query 读取 feed 与 delivered items', async () => {
  await withOwnedRuntime(TEST_RUNTIME, async () => {
    const db = createDbClient({ sqlite: createSqliteConfig('summary-with-facts.db') })
    const summaryQueryService = createSummaryQueryService(db)
    const contentRuntime = createContentRuntime()

    await insertSourceRun(db, {
      runId: 'run-summary-prev',
      sourceId: 'summary.daily',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-11T09:00:00.000Z',
      startedAt: '2026-04-11T09:00:00.000Z',
      finishedAt: '2026-04-11T09:00:00.000Z',
      counts: {
        fetchedCount: 0,
        parsedCount: 0,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })

    await insertSourceRun(db, {
      runId: 'run-rust-1',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-12T08:00:00.000Z',
      startedAt: '2026-04-12T08:00:00.000Z',
      finishedAt: '2026-04-12T08:00:00.000Z',
      counts: {
        fetchedCount: 1,
        parsedCount: 1,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 1,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await setSourceRunFeedSnapshot(db, 'run-rust-1', {
      title: 'Rust Feed',
      link: '',
      description: 'Rust Feed Description',
      generator: '',
      language: '',
      published: '',
    })
    await insertPipelineItem(db, {
      itemId: 'item-rust-1',
      sourceRunId: 'run-rust-1',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'rust-1',
        title: 'Rust Entry 1',
        link: '',
        description: 'Rust Entry 1 Description',
        content: '',
        published: '',
        updated: '',
      },
      status: 'delivered',
    })

    const result = await buildSummarySource({
      source: createSummarySource({
        summary: {
          sources: ['rust'],
          feed: {
            title: '{{ sources.rust.feed.title }} Daily Summary',
          },
          entry: {
            id: '{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}',
            title: '{{ sources.rust.entries[0].title }}',
            description:
              '{{ sources.rust.feed.description }}|{{ sources.rust.entries[0].description }}',
          },
        },
      }),
      upstreamSourceIds: ['rust'],
      scheduledAt: '2026-04-12T10:00:00.000Z',
      language: 'en-US',
      effectDomain: 'production',
      summaryQueryService,
      contentRuntime,
    })

    assertEquals(result.feedMapped.title, 'Rust Feed Daily Summary')
    assertEquals(result.entries.length, 1)
    assertEquals(result.entries[0].mapped.title, 'Rust Entry 1')
    assertEquals(
      result.entries[0].mapped.description,
      'Rust Feed Description|Rust Entry 1 Description',
    )

    db.$client.close()
  })
})

test('[contract] summarySource: 有 checkpoint 时应从 no_deliveries items 读取 summary 输入', async () => {
  await withOwnedRuntime(TEST_RUNTIME, async () => {
    const db = createDbClient({ sqlite: createSqliteConfig('summary-with-no-deliveries.db') })
    const summaryQueryService = createSummaryQueryService(db)
    const contentRuntime = createContentRuntime()

    await insertSourceRun(db, {
      runId: 'run-summary-prev-no-deliveries',
      sourceId: 'summary.daily',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-11T09:00:00.000Z',
      startedAt: '2026-04-11T09:00:00.000Z',
      finishedAt: '2026-04-11T09:00:00.000Z',
      counts: {
        fetchedCount: 0,
        parsedCount: 0,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })

    await insertSourceRun(db, {
      runId: 'run-rust-no-deliveries',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-12T08:00:00.000Z',
      startedAt: '2026-04-12T08:00:00.000Z',
      finishedAt: '2026-04-12T08:00:00.000Z',
      counts: {
        fetchedCount: 1,
        parsedCount: 1,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 1,
      },
    })
    await setSourceRunFeedSnapshot(db, 'run-rust-no-deliveries', {
      title: 'Rust Feed',
      link: '',
      description: 'Rust Feed Description',
      generator: '',
      language: '',
      published: '',
    })
    await insertPipelineItem(db, {
      itemId: 'item-rust-no-deliveries',
      sourceRunId: 'run-rust-no-deliveries',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'rust-no-deliveries',
        title: 'Rust Entry No Deliveries',
        link: 'https://example.com/rust-no-deliveries',
        description: 'Rust Entry No Deliveries Description',
        content: '',
        published: '2026-04-12T08:00:00.000Z',
        updated: '2026-04-12T08:00:00.000Z',
      },
      status: 'skipped',
      skippedReason: 'no_deliveries',
    })
    await insertPipelineItem(db, {
      itemId: 'item-rust-all-deliveries-duplicate',
      sourceRunId: 'run-rust-no-deliveries',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'rust-all-deliveries-duplicate',
        title: 'Rust Entry All Deliveries Duplicate',
        link: 'https://example.com/rust-all-deliveries-duplicate',
        description: 'Rust Entry All Deliveries Duplicate Description',
        content: '',
        published: '2026-04-12T08:01:00.000Z',
        updated: '2026-04-12T08:01:00.000Z',
      },
      status: 'skipped',
      skippedReason: 'all_deliveries_duplicate',
    })

    const result = await buildSummarySource({
      source: createSummarySource({
        summary: {
          sources: ['rust'],
          entry: {
            title: '{{ sources.rust.entries[0].title }}',
            description:
              '{{ sources.rust.feed.description }}|{{ sources.rust.entries[0].description }}',
            content: '{{ sources.rust.entries[0].link }} {{ sources.rust.entries[0].published }}',
          },
        },
      }),
      upstreamSourceIds: ['rust'],
      scheduledAt: '2026-04-12T10:00:00.000Z',
      language: 'en-US',
      effectDomain: 'production',
      summaryQueryService,
      contentRuntime,
    })

    assertEquals(result.entries.length, 1)
    assertEquals(result.entries[0].mapped.title, 'Rust Entry No Deliveries')
    assertEquals(
      result.entries[0].mapped.description,
      'Rust Feed Description|Rust Entry No Deliveries Description',
    )
    assertStringIncludes(result.entries[0].mapped.content, 'https://example.com/rust-no-deliveries')
    assertStringIncludes(result.entries[0].mapped.content, '2026-04-12T08:00:00.000Z')
    assertEquals(result.entries[0].mapped.content.includes('all-deliveries-duplicate'), false)

    db.$client.close()
  })
})

test('[contract] summarySource: summary 模板中的 ai_summarize 应可通过 contentRuntime 工作', async () => {
  await withOwnedRuntime(TEST_RUNTIME, async () => {
    const db = createDbClient({ sqlite: createSqliteConfig('summary-ai.db') })
    const summaryQueryService = createSummaryQueryService(db)
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
      generateText: () => Promise.resolve({ text: 'AI Summary' }),
    })
    const contentRuntime = createContentRuntime({ aiRuntime })

    await insertSourceRun(db, {
      runId: 'run-summary-prev-ai',
      sourceId: 'summary.daily',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-11T09:00:00.000Z',
      startedAt: '2026-04-11T09:00:00.000Z',
      finishedAt: '2026-04-11T09:00:00.000Z',
      counts: {
        fetchedCount: 0,
        parsedCount: 0,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await insertSourceRun(db, {
      runId: 'run-rust-ai',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-12T08:00:00.000Z',
      startedAt: '2026-04-12T08:00:00.000Z',
      finishedAt: '2026-04-12T08:00:00.000Z',
      counts: {
        fetchedCount: 1,
        parsedCount: 1,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 1,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await setSourceRunFeedSnapshot(db, 'run-rust-ai', {
      title: 'Rust Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '',
    })
    await insertPipelineItem(db, {
      itemId: 'item-rust-ai',
      sourceRunId: 'run-rust-ai',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'rust-ai',
        title: 'Rust Entry AI',
        link: '',
        description: '需要摘要',
        content: '',
        published: '',
        updated: '',
      },
      status: 'delivered',
    })

    const result = await buildSummarySource({
      source: createSummarySource({
        summary: {
          sources: ['rust'],
          entry: {
            id: '{{ entry.id }}',
            description: '{{ sources.rust.entries[0].description | ai_summarize }}',
          },
        },
      }),
      upstreamSourceIds: ['rust'],
      scheduledAt: '2026-04-12T10:00:00.000Z',
      language: 'en-US',
      effectDomain: 'production',
      summaryQueryService,
      contentRuntime,
    })

    assertEquals(result.entries.length, 1)
    assertEquals(result.entries[0].mapped.description, 'AI Summary')

    db.$client.close()
  })
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R17'],
  },
  {
    title:
      '[flow] R17 summarySource: 有 checkpoint 时应从 v2 facts query 读取 feed 与 delivered items',
    layer: 'flow',
    risks: ['R17'],
  },
] as const
