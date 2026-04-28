import { assertEquals } from '../../testing/assert.ts'
import YAML from 'yaml'
import { clearSourceHistory, runSourceNow, updateSourceConfig } from './source_management.ts'
import { createFactsDbClient } from '../../db/client.ts'
import { insertDeliveryAttempt } from '../../infrastructure/sqlite/delivery_attempt_repository.ts'
import { insertPipelineItem } from '../../infrastructure/sqlite/item_repository.ts'
import { insertSourceRun } from '../../infrastructure/sqlite/run_repository.ts'
import { readTextFile } from '../../platform/fs.ts'
import { test } from '../../testing/test_api.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from '../../testing/test_helpers.ts'

const CONFIG_YML = `sqlite:\n  path: facts.db\nlogging:\n  level: info\ndeliveries:\n  local:\n    file:\n      path: outputs/releases.md\n      content: '{{ entry.title }}'\n  telegram:\n    push:\n      http:\n        url: https://example.com/webhook\n      request:\n        type: body\n        payload:\n          text: '{{ entry.title }}'\nsources:\n  rust:\n    name: Rust Blog\n    enabled: true\n    schedule: '*/30 * * * *'\n    http:\n      url: https://example.com/feed.xml\n    syndication: {}\n    deliveries:\n      local:\n        content: '{{ entry.title }}'\n      telegram: {}\n`

async function withRuntimeDir(fn: (runtimeDir: string) => Promise<void>) {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(runtimeDir, 'config.yml', CONFIG_YML)
    await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
      await fn(runtimeDir)
    })
  })
}

test('[contract] source management: updateSourceConfig 应写回 source 子树并保留 keyed deliveries', async () => {
  await withRuntimeDir(async (runtimeDir) => {
    const result = await updateSourceConfig({
      sourceId: 'rust',
      name: 'Rust Releases',
      enabled: true,
      schedule: '0 * * * *',
      filter: '{{ title }}',
      deliveryIds: ['local', 'telegram'],
      deliveryOverrides: {
        local: {
          content: '{{ entry.title }}\\n\\n{{ entry.link }}',
        },
        telegram: {
          payload: {
            text: '{{ entry.title }} => {{ entry.link }}',
          },
        },
      },
      transport: 'http',
      parser: 'xquery',
      targetUrl: 'https://example.com/releases',
      xqueryLocate: '//article',
      xqueryEntryId: 'string(@data-id)',
    })

    assertEquals(result.message, 'source rust 配置已保存')
    const nextConfig = YAML.parse(await readTextFile(`${runtimeDir}/config.yml`)) as {
      sources?: Record<
        string,
        {
          name?: string
          schedule?: string
          filter?: string
          http?: { url?: string }
          xquery?: { locate?: string; entry?: { id?: string } }
          deliveries?: Record<string, { content?: string; payload?: { text?: string } }>
        }
      >
    }
    const rust = nextConfig.sources?.rust
    assertEquals(rust?.name, 'Rust Releases')
    assertEquals(rust?.schedule, '0 * * * *')
    assertEquals(rust?.filter, '{{ title }}')
    assertEquals(result.overview.sources[0]?.name, 'Rust Releases')
    assertEquals(result.overview.sources[0]?.parser, 'xquery')
    assertEquals(rust?.http?.url, 'https://example.com/releases')
    assertEquals(rust?.xquery?.locate, '//article')
    assertEquals(rust?.xquery?.entry?.id, 'string(@data-id)')
    assertEquals(rust?.deliveries?.telegram?.payload?.text, '{{ entry.title }} => {{ entry.link }}')
  })
})

test('[contract] source management: clearSourceHistory 应只删除指定 source 的 production facts', async () => {
  await withRuntimeDir(async (runtimeDir) => {
    const factsDb = createFactsDbClient({
      sqlite: {
        path: `${runtimeDir}/facts.db`,
        busyTimeout: '5s',
        journalMode: 'WAL',
        retention: {
          maxAge: '7d',
          maxEntriesPerSource: 100,
          vacuum: 'off',
        },
      },
    })

    try {
      await insertSourceRun(factsDb, {
        runId: 'run-rust',
        sourceId: 'rust',
        trigger: 'manual',
        profile: 'production',
        effectDomain: 'production',
        status: 'success',
        scheduledAt: '2026-04-21T10:00:00.000Z',
        startedAt: '2026-04-21T10:00:00.000Z',
        finishedAt: '2026-04-21T10:00:01.000Z',
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
      await insertPipelineItem(factsDb, {
        itemId: 'item-rust',
        sourceRunId: 'run-rust',
        sourceId: 'rust',
        effectDomain: 'production',
        normalized: {
          id: 'entry-rust',
          title: 'Rust Entry',
          link: '',
          description: '',
          content: '',
          published: '',
          updated: '',
        },
        status: 'skipped',
      })
      await insertDeliveryAttempt(factsDb, {
        attemptId: 'attempt-rust',
        itemId: 'item-rust',
        sourceRunId: 'run-rust',
        deliveryId: 'local',
        channel: 'file',
        effectDomain: 'production',
        attemptNumber: 1,
        status: 'delivered',
        plannedAt: '2026-04-21T10:00:00.000Z',
        startedAt: '2026-04-21T10:00:00.000Z',
        finishedAt: '2026-04-21T10:00:01.000Z',
      })
      await insertSourceRun(factsDb, {
        runId: 'run-other',
        sourceId: 'other',
        trigger: 'manual',
        profile: 'production',
        effectDomain: 'production',
        status: 'success',
        scheduledAt: '2026-04-21T10:00:00.000Z',
        startedAt: '2026-04-21T10:00:00.000Z',
        finishedAt: '2026-04-21T10:00:01.000Z',
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

      const result = await clearSourceHistory({ sourceId: 'rust' })
      assertEquals(result.deletedRuns, 1)
      assertEquals(result.deletedItems, 1)
      assertEquals(result.deletedAttempts, 1)
      assertEquals(result.overview.sources[0]?.entries.length, 0)
      assertEquals(
        factsDb.$client.prepare('SELECT COUNT(*) AS count FROM delivery_attempts').get(),
        { count: 0 },
      )
    } finally {
      factsDb.$client.close()
    }
  })
})

test('[contract] source management: updateSourceConfig 对编译期 delivery 引用错误应返回 validation 错误', async () => {
  await withRuntimeDir(async () => {
    let message = ''
    try {
      await updateSourceConfig({
        sourceId: 'rust',
        name: 'Rust Blog',
        enabled: true,
        schedule: '*/30 * * * *',
        filter: '',
        deliveryIds: ['missing_delivery'],
        deliveryOverrides: {},
        transport: 'http',
        parser: 'syndication',
        targetUrl: 'https://example.com/feed.xml',
        xqueryLocate: '',
        xqueryEntryId: '',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    assertEquals(message, 'source.rust.deliveries 引用了未定义 delivery: missing_delivery')
  })
})

test('[contract] source management: 应保留未修改的 source override secret', async () => {
  await withRuntimeDir(async (runtimeDir) => {
    const configYml = `sqlite:\n  path: facts.db\nlogging:\n  level: info\ndeliveries:\n  telegram:\n    push:\n      http:\n        url: https://example.com/webhook\n      request:\n        type: body\n        payload:\n          text: '{{ entry.title }}'\nsources:\n  rust:\n    enabled: true\n    http:\n      url: https://example.com/feed.xml\n    syndication: {}\n    deliveries:\n      telegram:\n        payload:\n          text: hi\n          token: real-token\n`
    await writeRuntimeFile(runtimeDir, 'config.yml', configYml)

    await updateSourceConfig({
      sourceId: 'rust',
      name: 'Rust Blog',
      enabled: true,
      schedule: '*/30 * * * *',
      filter: '',
      deliveryIds: ['telegram'],
      deliveryOverrides: {
        telegram: {
          payload: {
            text: 'updated',
            token: '__KNOCK_SECRET_UNCHANGED__',
          },
        },
      },
      transport: 'http',
      parser: 'syndication',
      targetUrl: 'https://example.com/feed.xml',
      xqueryLocate: '',
      xqueryEntryId: '',
    })

    const nextConfig = YAML.parse(await readTextFile(`${runtimeDir}/config.yml`)) as {
      sources?: Record<string, { deliveries?: Record<string, { payload?: { token?: string } }> }>
    }
    assertEquals(nextConfig.sources?.rust?.deliveries?.telegram?.payload?.token, 'real-token')
  })
})

test('[contract] source management: runSourceNow 对停用 source 应返回冲突错误', async () => {
  await withRuntimeDir(async () => {
    let message = ''
    try {
      await updateSourceConfig({
        sourceId: 'rust',
        name: 'Rust Blog',
        enabled: false,
        schedule: '*/30 * * * *',
        filter: '',
        deliveryIds: ['telegram'],
        deliveryOverrides: {},
        transport: 'http',
        parser: 'syndication',
        targetUrl: 'https://example.com/feed.xml',
        xqueryLocate: '',
        xqueryEntryId: '',
      })
      await runSourceNow({ sourceId: 'rust' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    assertEquals(message, 'source rust 已停用，不能强制获取')
  })
})
