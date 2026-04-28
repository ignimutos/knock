import { assertEquals, assertExists } from '../testing/assert.ts'
import type { AppConfigResolved } from '../config/types.ts'
import { createInMemoryDb } from '../db/client.ts'
import type { SourceRun } from '../domain/source_run.ts'
import { insertPipelineItem } from '../infrastructure/sqlite/item_repository.ts'
import {
  insertSourceRun,
  setSourceRunFeedSnapshot,
} from '../infrastructure/sqlite/run_repository.ts'
import { buildReaderOverview, loadReaderOverview } from './reader_overview.ts'
import { test } from '../testing/test_api.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from '../testing/test_helpers.ts'

function createConfig(): AppConfigResolved {
  return {
    runtimeDir: '/tmp/runtime',
    language: 'zh-CN',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: '/tmp/runtime/facts.db',
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '1d',
        maxEntriesPerSource: 100,
        vacuum: 'off',
      },
    },
    ai: undefined,
    deliveries: [],
    sources: [
      {
        id: 'rust',
        name: 'Rust Blog',
        enabled: true,
        schedule: '*/30 * * * *',
        deliveries: [],
        http: {
          url: 'https://example.com/feed.xml?token=secret',
        },
        syndication: {},
      },
      {
        id: 'daily',
        enabled: false,
        deliveries: [],
        summary: {
          sources: ['rust'],
        },
      },
    ],
    logging: {
      level: 'info',
      sinks: {},
    },
  }
}

function createSuccessRun(): SourceRun {
  return {
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'success',
    scheduledAt: '2026-04-20T09:00:00.000Z',
    startedAt: '2026-04-20T09:00:01.000Z',
    finishedAt: '2026-04-20T09:00:02.000Z',
    counts: {
      fetchedCount: 2,
      parsedCount: 2,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 1,
      failedAttemptCount: 0,
      skippedCount: 1,
    },
  }
}

test('[contract] reader overview: 应按 source 返回最近快照并清理敏感 URL', async () => {
  const db = createInMemoryDb()
  await insertSourceRun(db, createSuccessRun())
  await setSourceRunFeedSnapshot(db, 'run-1', {
    title: 'Rust Feed',
    link: 'https://example.com/',
    description: '<p>Latest posts</p>',
    generator: 'rss',
    language: 'en',
    published: '2026-04-20T09:00:00.000Z',
  })
  await insertPipelineItem(db, {
    itemId: 'item-1',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-1',
      title: 'First',
      link: 'https://example.com/1',
      description: '<p>First body</p>',
      content: '<p>Alpha</p>',
      published: '2026-04-19T09:00:00.000Z',
      updated: '',
    },
    status: 'delivered',
  })
  await insertPipelineItem(db, {
    itemId: 'item-2',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-2',
      title: 'Second',
      link: 'https://example.com/2',
      description: '<p>Second body</p>',
      content: '<p>Beta</p>',
      published: '2026-04-20T10:00:00.000Z',
      updated: '',
    },
    status: 'skipped',
    skippedReason: 'no_deliveries',
  })

  const overview = await buildReaderOverview({
    config: createConfig(),
    rawDocument: {
      sources: {
        rust: {},
        daily: {},
      },
    },
    factsDb: db,
  })

  assertEquals(overview.issue, undefined)
  assertEquals(overview.deliveries, [])
  assertEquals(overview.sources.length, 2)

  const rust = overview.sources[0]
  assertExists(rust)
  assertEquals(rust.name, 'Rust Blog')
  assertEquals(rust.transport, 'http')
  assertEquals(rust.parser, 'syndication')
  assertEquals(rust.sourceUrl, 'https://example.com/feed.xml')
  assertEquals(rust.lastRun?.runId, 'run-1')
  assertEquals(rust.feed?.title, 'Rust Feed')
  assertEquals(rust.filter, undefined)
  assertEquals(rust.deliveryIds, [])
  assertEquals(rust.deliveryOverrides, {})
  assertEquals(rust.xqueryLocate, undefined)
  assertEquals(rust.xqueryEntryId, undefined)
  assertEquals(
    rust.entries.map((entry) => entry.id),
    ['entry-2', 'entry-1'],
  )

  const daily = overview.sources[1]
  assertExists(daily)
  assertEquals(daily.name, 'daily')
  assertEquals(daily.transport, 'summary')
  assertEquals(daily.parser, 'summary')
  assertEquals(daily.entries.length, 0)
})

test('[contract] reader overview: Reader 加载配置时应保留未定义 env 占位符而不是报错', async () => {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(
      runtimeDir,
      'config.yml',
      `sqlite:\n  path: db/knock.db\nlogging:\n  level: info\ndeliveries:\n  telegram:\n    enabled: false\n    push:\n      http:\n        url: https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/sendMessage\n      request:\n        type: body\n        payload:\n          chat_id: \${TELEGRAM_CHAT_ID}\nsources:\n  rust:\n    http:\n      url: https://example.com/feed.xml\n    deliveries:\n      telegram: {}\n`,
    )

    await withEnv(
      {
        KNOCK_RUNTIME_DIR: runtimeDir,
        TELEGRAM_BOT_TOKEN: undefined,
        TELEGRAM_CHAT_ID: undefined,
      },
      async () => {
        const overview = await loadReaderOverview()
        assertEquals(overview.issue, undefined)
        assertEquals(overview.sources.length, 1)
        assertEquals(overview.sources[0]?.id, 'rust')
      },
    )
  })
})
