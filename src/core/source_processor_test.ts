import { assertEquals, assertRejects } from '@std/assert'
import type { ResolvedSourceConfig } from '../config/types.ts'
import { attachAiEntryRuntime, getAiEntryRuntime } from './ai_runtime.ts'
import type { Logger } from './logger.ts'
import { createSourceProcessor } from './source_processor.ts'

function createTestLogger(
  records: Array<Record<string, unknown>>,
  baseFields: Record<string, unknown> = {},
): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    records.push({
      level,
      message,
      ...baseFields,
      ...(fields ?? {}),
    })
  }

  return {
    trace: (message, fields) => write('trace', message, fields),
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createTestLogger(records, { ...baseFields, ...fields }),
  }
}

function createSource(overrides: Partial<ResolvedSourceConfig> = {}): ResolvedSourceConfig {
  return {
    id: 'rust',
    enabled: true,
    http: { url: 'https://example.com/feed.xml' },
    syndication: {},
    deliveries: [
      {
        id: 'archive',
        file: {
          path: 'outputs/feed.md',
          content: '{{ entry.title }}',
        },
      },
    ],
    ...overrides,
  }
}

Deno.test('sourceProcessor: runOnce 应接管单 source 执行主循环并保留现有日志与计数', async () => {
  const logs: Array<Record<string, unknown>> = []
  const schedulerCalls: string[] = []
  const pushedItemIds: string[] = []
  const persisted: Array<Record<string, unknown>> = []
  const pruned: Array<Record<string, unknown>> = []
  const filterCalls: string[] = []
  const aiRuntimeCalls: Array<{ sourceId: string; entryId: string }> = []
  const pushedContextAiEntryIds: string[] = []

  const source = createSource()
  const processor = createSourceProcessor({
    logger: createTestLogger(logs),
    scheduler: {
      runSource: async (sourceId, task) => {
        schedulerCalls.push(sourceId)
        await task()
      },
    },
    sourceRuntime: {
      fetchAndParse: () =>
        Promise.resolve({
          parser: 'rss',
          payload: '<rss />',
          feedMapped: { title: 'Rust Feed' },
          entries: [
            { mapped: { id: '   ', title: 'skip' } },
            { mapped: { id: 'filtered', title: 'Filtered' } },
            { mapped: { id: 'delivered', title: 'Delivered' } },
            { mapped: { id: 'deduped', title: 'Deduped' } },
          ],
          timing: {
            fetchDurationMs: 11,
            parseDurationMs: 17,
          },
        }),
    },
    contentRuntime: {
      buildContext: (entry, feed, currentSource, aiEntryRuntime) =>
        attachAiEntryRuntime(
          {
            entry,
            feed,
            source: currentSource,
          },
          aiEntryRuntime,
        ),
      shouldPassFilter: (_filter, context) => {
        const itemId = String((context.entry as { id?: string }).id ?? '')
        filterCalls.push(itemId)
        return Promise.resolve(itemId !== 'filtered')
      },
    },
    deliveryRuntime: {
      getDeliveryId: (delivery) => `delivery:${delivery.id}`,
      push: (_delivery, context) => {
        pushedItemIds.push(String((context.entry as { id?: string }).id ?? ''))
        pushedContextAiEntryIds.push(String(getAiEntryRuntime(context)?.entryId ?? ''))
        return Promise.resolve()
      },
    },
    sourceStateStore: {
      persistParsedSource: (input) => {
        persisted.push(input as unknown as Record<string, unknown>)
        return Promise.resolve()
      },
      deliverIfNeeded: async (_sourceId, itemId, _targetId, push) => {
        if (itemId === 'deduped') return 'deduped'
        await push()
        return 'delivered'
      },
      pruneSourceState: (sourceId, activeTargetCount) => {
        pruned.push({ sourceId, activeTargetCount })
      },
    },
    aiRuntime: {
      createEntryRuntime: (sourceId, entryId) => {
        aiRuntimeCalls.push({ sourceId, entryId })
        return { sourceId, entryId, cache: new Map() }
      },
      translate: () => Promise.resolve(''),
      summarize: () => Promise.resolve(''),
    },
    createRunId: () => 'run-1',
    now: (() => {
      const values = [1000, 1010, 1020, 1030, 1040]
      let index = 0
      return () => values[index++] ?? values[values.length - 1]
    })(),
  })

  await processor.runOnce(source)

  assertEquals(schedulerCalls, ['rust'])
  assertEquals(filterCalls, ['filtered', 'delivered', 'deduped'])
  assertEquals(aiRuntimeCalls, [
    { sourceId: 'rust', entryId: 'filtered' },
    { sourceId: 'rust', entryId: 'delivered' },
    { sourceId: 'rust', entryId: 'deduped' },
  ])
  assertEquals(pushedItemIds, ['delivered'])
  assertEquals(pushedContextAiEntryIds, ['delivered'])
  assertEquals(persisted.length, 1)
  assertEquals(persisted[0].sourceId, 'rust')
  assertEquals(pruned, [{ sourceId: 'rust', activeTargetCount: 1 }])
  assertEquals(
    logs.some((line) => line.message === '跳过无效 entry' && line.reason === 'entry.id_empty'),
    true,
  )
  assertEquals(
    logs.some(
      (line) =>
        line.message === 'filter 结果' &&
        line.outcome === 'filtered' &&
        line.item_id === 'filtered',
    ),
    true,
  )
  assertEquals(
    logs.some(
      (line) =>
        line.message === '命中去重' &&
        line.module === 'delivery.store' &&
        line.item_id === 'deduped',
    ),
    true,
  )
  assertEquals(
    logs.some(
      (line) =>
        line.message === '记录 delivered' &&
        line.module === 'delivery.store' &&
        line.item_id === 'delivered',
    ),
    true,
  )
  assertEquals(
    logs.some(
      (line) =>
        line.message === 'source 执行完成' &&
        line.module === 'scheduler.source' &&
        line.item_count === 4 &&
        line.passed_count === 2 &&
        line.deduped_count === 1 &&
        line.pushed_count === 1,
    ),
    true,
  )
})

Deno.test(
  'sourceProcessor: runOnce 应按 delivery 维度独立去重并只推送未去重的 delivery',
  async () => {
    const deliverCalls: Array<{ itemId: string; deliveryId: string }> = []
    const pushedDeliveryIds: string[] = []
    const source = createSource({
      deliveries: [
        {
          id: 'archive_a',
          file: {
            path: 'outputs/archive-a.md',
            content: '{{ entry.title }}',
          },
        },
        {
          id: 'archive_b',
          file: {
            path: 'outputs/archive-b.md',
            content: '{{ entry.title }}',
          },
        },
      ],
    })
    const processor = createSourceProcessor({
      logger: createTestLogger([]),
      scheduler: {
        runSource: (_sourceId, task) => task(),
      },
      sourceRuntime: {
        fetchAndParse: () =>
          Promise.resolve({
            parser: 'rss',
            payload: '<rss />',
            feedMapped: { title: 'Rust Feed' },
            entries: [{ mapped: { id: 'entry-1', title: 'Delivered once' } }],
            timing: {
              fetchDurationMs: 1,
              parseDurationMs: 1,
            },
          }),
      },
      contentRuntime: {
        buildContext: (entry, feed, currentSource) => ({ entry, feed, source: currentSource }),
        shouldPassFilter: () => Promise.resolve(true),
      },
      deliveryRuntime: {
        getDeliveryId: (delivery) => `delivery:${delivery.id}`,
        push: (delivery) => {
          pushedDeliveryIds.push(delivery.id)
          return Promise.resolve()
        },
      },
      sourceStateStore: {
        persistParsedSource: () => Promise.resolve(),
        deliverIfNeeded: async (_sourceId, itemId, deliveryId, push) => {
          deliverCalls.push({ itemId, deliveryId })
          if (deliveryId === 'delivery:archive_b') return 'deduped'
          await push()
          return 'delivered'
        },
        pruneSourceState: () => {},
      },
      createRunId: () => 'run-delivery-dedup',
      now: () => 1000,
    })

    await processor.runOnce(source)

    assertEquals(deliverCalls, [
      { itemId: 'entry-1', deliveryId: 'delivery:archive_a' },
      { itemId: 'entry-1', deliveryId: 'delivery:archive_b' },
    ])
    assertEquals(pushedDeliveryIds, ['archive_a'])
  },
)

Deno.test('sourceProcessor: runOnce 遇到 push 失败时不记录 delivered 且继续向外抛出', async () => {
  const logs: Array<Record<string, unknown>> = []
  const deliverIfNeededCalls: string[] = []
  const pushCalls: string[] = []
  const processor = createSourceProcessor({
    logger: createTestLogger(logs),
    scheduler: {
      runSource: (_sourceId, task) => task(),
    },
    sourceRuntime: {
      fetchAndParse: () =>
        Promise.resolve({
          parser: 'rss',
          payload: '<rss />',
          feedMapped: { title: 'Rust Feed' },
          entries: [{ mapped: { id: 'failed', title: 'Failed' } }],
          timing: {
            fetchDurationMs: 11,
            parseDurationMs: 17,
          },
        }),
    },
    contentRuntime: {
      buildContext: (entry, feed, currentSource) => ({ entry, feed, source: currentSource }),
      shouldPassFilter: () => Promise.resolve(true),
    },
    deliveryRuntime: {
      getDeliveryId: () => 'delivery:archive',
      push: (_delivery, context) => {
        pushCalls.push(String((context.entry as { id?: string }).id ?? ''))
        return Promise.reject(new Error('push failed'))
      },
    },
    sourceStateStore: {
      persistParsedSource: () => Promise.resolve(),
      deliverIfNeeded: async (_sourceId, _itemId, targetId, push) => {
        deliverIfNeededCalls.push(targetId)
        await push()
        return 'delivered'
      },
      pruneSourceState: () => {},
    },
    createRunId: () => 'run-push-failed',
    now: () => 1000,
  })

  await assertRejects(() => processor.runOnce(createSource()), Error, 'push failed')

  assertEquals(deliverIfNeededCalls, ['delivery:archive'])
  assertEquals(pushCalls, ['failed'])
  assertEquals(
    logs.some((line) => line.message === '记录 delivered'),
    false,
  )
})

Deno.test('sourceProcessor: runOnce 遇到异常时应记录失败并继续向外抛出', async () => {
  const logs: Array<Record<string, unknown>> = []
  const processor = createSourceProcessor({
    logger: createTestLogger(logs),
    scheduler: {
      runSource: (_sourceId, task) => task(),
    },
    sourceRuntime: {
      fetchAndParse: () => Promise.reject(new Error('boom')),
    },
    contentRuntime: {
      buildContext: () => ({}),
      shouldPassFilter: () => Promise.resolve(true),
    },
    deliveryRuntime: {
      getDeliveryId: () => 'delivery:archive',
      push: () => Promise.resolve(),
    },
    sourceStateStore: {
      persistParsedSource: () => Promise.resolve(),
      deliverIfNeeded: () => Promise.resolve('delivered'),
      pruneSourceState: () => {},
    },
    createRunId: () => 'run-err',
    now: () => 1000,
  })

  await assertRejects(() => processor.runOnce(createSource()), Error, 'boom')

  assertEquals(
    logs.some((line) => line.message === 'source 执行失败' && line.error_message === 'boom'),
    true,
  )
})
