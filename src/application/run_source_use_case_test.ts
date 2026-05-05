import { assertEquals, assertRejects } from '../testing/assert.ts'
import { createLogger } from '../core/logger.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { SourceParser } from './ports/source_parser.ts'
import type { SourceInputGateway } from './ports/source_input_gateway.ts'
import { RunSourceUseCase, type RunSourceRequest } from './run_source_use_case.ts'
import { test } from '../testing/test_api.ts'

// risk-id: R07
// layer: contract

function createUseCaseWithRecorder(calls: string[]) {
  const sourceInputGateway: SourceInputGateway = {
    fetch: (plan) => {
      calls.push(`fetch:${plan.source.kind}`)
      return Promise.resolve({
        kind: plan.source.kind,
        collectedAt: '2026-04-13T09:00:00.000Z',
        payloadSummary: {
          hash: 'hash-1',
          bytes: 10,
        },
      })
    },
  }

  const sourceParser: SourceParser = {
    parse: (plan, input) => {
      calls.push(`parse:${plan.source.kind}:${input.kind}`)
      return Promise.resolve({
        sourceKind: input.kind,
        parser: input.kind === 'summary' ? 'summary' : 'rss',
        diagnostics: [],
        feed: {
          title: 'Feed',
          link: '',
          description: '',
          generator: '',
          language: '',
          published: '',
        },
        items: [],
      })
    },
  }

  return new RunSourceUseCase({
    now: () => '2026-04-13T09:00:00.000Z',
    createRunId: () => 'run-1',
    sourceInputGateway,
    sourceParser,
    runRepository: {
      insert: () => Promise.resolve(),
      update: () => Promise.resolve(),
    },
    itemRepository: {
      insertMany: () => Promise.resolve(),
      updateStatus: () => Promise.resolve(),
    },
    deliveryAttemptRepository: {
      insertPlanned: () => Promise.resolve(),
      finish: () => Promise.resolve(),
    },
    deduplicationRepository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: () => Promise.resolve(false),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
    deliveryExecutors: {
      file: { execute: () => Promise.resolve() },
      push: { execute: () => Promise.resolve() },
      email: { execute: () => Promise.resolve() },
    },
  })
}

test('[contract] runSourceUseCase: summary 与 fetch source 应共享主生命周期入口', async () => {
  const calls: string[] = []
  const useCase = createUseCaseWithRecorder(calls)

  const summarySource: SourceDefinition = {
    kind: 'summary',
    sourceId: 'daily',
    upstreamSourceIds: ['rust'],
  }
  const fetchSource: SourceDefinition = {
    kind: 'fetch',
    sourceId: 'rust',
    fetcher: 'http',
    parser: 'syndication',
  }

  await useCase.execute({
    source: summarySource,
    profile: 'preview',
    effectDomain: 'preview',
    trigger: 'preview',
  })
  await useCase.execute({
    source: fetchSource,
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
  })

  assertEquals(calls, [
    'fetch:summary',
    'parse:summary:summary',
    'fetch:fetch',
    'parse:fetch:fetch',
  ])
})

test('[contract] runSourceUseCase: 应生成可复用的 RunPlan 并保留 bindings', async () => {
  const useCase = createUseCaseWithRecorder([])
  const bindings: DeliveryBinding[] = [
    {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate: '{{ title }}',
      },
    },
  ]

  const plan = await useCase.plan({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    bindings,
  })

  assertEquals(plan.runId, 'run-1')
  assertEquals(plan.source.sourceId, 'rust')
  assertEquals(plan.profile, 'production')
  assertEquals(plan.effectDomain, 'production')
  assertEquals(plan.trigger, 'scheduled')
  assertEquals(plan.scheduledAt, '2026-04-13T09:00:00.000Z')
  assertEquals(plan.bindings, bindings)
})

test('[contract] runSourceUseCase: run-level lifecycle logs 应覆盖 start/finalize(success) 与聚合计数', async () => {
  const logs: string[] = []

  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T11:50:00.000Z',
    createRunId: () => 'run-owner-logs',
    createItemId: (entry) => `item:${entry.id}`,
    sourceInputGateway: {
      fetch: (plan) =>
        Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T11:50:00.000Z',
          payloadSummary: { hash: 'hash-owner-logs', bytes: 10 },
        }),
    },
    sourceParser: {
      parse: () =>
        Promise.resolve({
          sourceKind: 'fetch',
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [
            {
              id: 'entry-filtered',
              title: 'Filtered',
              link: '',
              description: '',
              content: '',
              published: '',
              updated: '',
            },
            {
              id: 'entry-deduped',
              title: 'Deduped',
              link: '',
              description: '',
              content: '',
              published: '',
              updated: '',
            },
            {
              id: 'entry-delivered',
              title: 'Delivered',
              link: '',
              description: '',
              content: '',
              published: '',
              updated: '',
            },
          ],
        }),
    },
    runRepository: {
      insert: () => Promise.resolve(),
      update: () => Promise.resolve(),
    },
    itemRepository: {
      insertMany: () => Promise.resolve(),
      updateStatus: () => Promise.resolve(),
    },
    deliveryAttemptRepository: {
      insertPlanned: () => Promise.resolve(),
      finish: () => Promise.resolve(),
    },
    deduplicationRepository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: ({ fingerprint }) => Promise.resolve(fingerprint === 'entry-deduped'),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
    deliveryExecutors: {
      file: { execute: () => Promise.resolve() },
    },
    shouldPassFilter: ({ item }) => Promise.resolve(item.id !== 'entry-filtered'),
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'scheduler.source',
      now: () => new Date('2026-04-13T11:50:00.000Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  await useCase.execute({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
      filter: '{{ true }}',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    bindings: [
      {
        sourceId: 'rust',
        deliveryId: 'archive',
        definition: {
          kind: 'file',
          deliveryId: 'archive',
          path: '/tmp/archive.txt',
          contentTemplate: '{{ entry.title }}',
        },
      },
    ],
  })

  const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  const startLog = records.find((record) => {
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'scheduler.source' &&
      attributes['scheduler.operation'] === 'run_source' &&
      attributes['scheduler.outcome'] === 'start'
    )
  })
  const finalizeLog = records.find((record) => {
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'scheduler.source' &&
      attributes['scheduler.operation'] === 'run_source' &&
      attributes['scheduler.outcome'] === 'success'
    )
  })

  assertEquals(Boolean(startLog), true)
  assertEquals(Boolean(finalizeLog), true)

  const startAttributes = (startLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(startAttributes['source.id'], 'rust')
  assertEquals(startAttributes['source.run_id'], 'run-owner-logs')
  assertEquals(startAttributes['scheduler.trigger'], 'scheduled')

  const finalizeAttributes = (finalizeLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(finalizeAttributes['source.id'], 'rust')
  assertEquals(finalizeAttributes['source.run_id'], 'run-owner-logs')
  assertEquals(finalizeAttributes['source.item_count'], 3)
  assertEquals(finalizeAttributes['pipeline.filtered_count'], 1)
  assertEquals(finalizeAttributes['delivery.deduped_count'], 1)
  assertEquals(finalizeAttributes['delivery.pushed_count'], 1)
  assertEquals(finalizeAttributes['delivery.failed_count'], 0)
})

test('[contract] runSourceUseCase: collect 只应执行 plan、fetch、parse', async () => {
  const calls: string[] = []
  const request: RunSourceRequest = {
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
  }
  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T12:00:00.000Z',
    createRunId: () => 'run-collect',
    sourceInputGateway: {
      fetch: (plan) => {
        calls.push(`fetch:${plan.runId}`)
        return Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T12:00:01.000Z',
          payloadSummary: { hash: 'hash-collect', bytes: 10 },
        })
      },
    },
    sourceParser: {
      parse: (plan, input) => {
        calls.push(`parse:${plan.runId}:${input.kind}`)
        return Promise.resolve({
          sourceKind: input.kind,
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [],
        })
      },
    },
    runRepository: {
      insert: () => {
        calls.push('run.insert')
        return Promise.resolve()
      },
      update: () => {
        calls.push('run.update')
        return Promise.resolve()
      },
    },
    itemRepository: {
      insertMany: () => {
        calls.push('item.insertMany')
        return Promise.resolve()
      },
      updateStatus: () => {
        calls.push('item.updateStatus')
        return Promise.resolve()
      },
    },
    deliveryAttemptRepository: {
      insertPlanned: () => {
        calls.push('attempt.insertPlanned')
        return Promise.resolve()
      },
      finish: () => {
        calls.push('attempt.finish')
        return Promise.resolve()
      },
    },
    deduplicationRepository: {
      isItemDuplicate: () => {
        calls.push('dedupe.item')
        return Promise.resolve(false)
      },
      registerItemFingerprint: () => {
        calls.push('dedupe.registerItem')
        return Promise.resolve()
      },
      isDeliveryDuplicate: () => {
        calls.push('dedupe.delivery')
        return Promise.resolve(false)
      },
      registerDeliveryFingerprint: () => {
        calls.push('dedupe.registerDelivery')
        return Promise.resolve()
      },
    },
    deliveryExecutors: {
      file: {
        execute: () => {
          calls.push('delivery.execute')
          return Promise.resolve()
        },
      },
    },
  })

  const result = await useCase.collect(request)

  assertEquals(result.plan.runId, 'run-collect')
  assertEquals(calls, ['fetch:run-collect', 'parse:run-collect:fetch'])
})

test('[contract] runSourceUseCase: 缺 pipeline deps 时 execute 应 fail fast', async () => {
  const calls: string[] = []
  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T12:05:00.000Z',
    createRunId: () => 'run-collect-only',
    sourceInputGateway: {
      fetch: (plan) => {
        calls.push(`fetch:${plan.runId}`)
        return Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T12:05:01.000Z',
          payloadSummary: { hash: 'hash-collect-only', bytes: 10 },
        })
      },
    },
    sourceParser: {
      parse: (plan, input) => {
        calls.push(`parse:${plan.runId}:${input.kind}`)
        return Promise.resolve({
          sourceKind: input.kind,
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [],
        })
      },
    },
  })

  await assertRejects(
    () =>
      useCase.execute({
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'preview',
        effectDomain: 'preview',
        trigger: 'preview',
      }),
    Error,
    'run source execute 缺少完整 pipeline 依赖',
  )
  assertEquals(calls, ['fetch:run-collect-only', 'parse:run-collect-only:fetch'])
})

test('[contract] runSourceUseCase: execute 应先 collect 再 applyCollected', async () => {
  const order: string[] = []
  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T12:10:00.000Z',
    createRunId: () => 'run-order',
    createItemId: (entry) => `item:${entry.id}`,
    sourceInputGateway: {
      fetch: (plan) => {
        order.push(`fetch:${plan.runId}`)
        return Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T12:10:01.000Z',
          payloadSummary: { hash: 'hash-order', bytes: 10 },
        })
      },
    },
    sourceParser: {
      parse: (plan, input) => {
        order.push(`parse:${plan.runId}:${input.kind}`)
        return Promise.resolve({
          sourceKind: input.kind,
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [
            {
              id: 'entry-1',
              title: 'Hello',
              link: '',
              description: '',
              content: '',
              published: '',
              updated: '',
            },
          ],
        })
      },
    },
    runRepository: {
      insert: () => {
        order.push('run.insert')
        return Promise.resolve()
      },
      update: () => {
        order.push('run.update')
        return Promise.resolve()
      },
    },
    itemRepository: {
      insertMany: () => {
        order.push('item.insertMany')
        return Promise.resolve()
      },
      updateStatus: () => {
        order.push('item.updateStatus')
        return Promise.resolve()
      },
    },
    deliveryAttemptRepository: {
      insertPlanned: () => {
        order.push('attempt.insertPlanned')
        return Promise.resolve()
      },
      finish: () => {
        order.push('attempt.finish')
        return Promise.resolve()
      },
    },
    deduplicationRepository: {
      isItemDuplicate: () => {
        order.push('dedupe.item')
        return Promise.resolve(true)
      },
      registerItemFingerprint: () => {
        order.push('dedupe.registerItem')
        return Promise.resolve()
      },
      isDeliveryDuplicate: () => {
        order.push('dedupe.delivery')
        return Promise.resolve(false)
      },
      registerDeliveryFingerprint: () => {
        order.push('dedupe.registerDelivery')
        return Promise.resolve()
      },
    },
    deliveryExecutors: {
      file: {
        execute: () => {
          order.push('delivery.execute')
          return Promise.resolve()
        },
      },
    },
  })

  const result = await useCase.execute({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    bindings: [
      {
        sourceId: 'rust',
        deliveryId: 'archive',
        definition: {
          kind: 'file',
          deliveryId: 'archive',
          path: '/tmp/archive.txt',
          contentTemplate: '{{ entry.title }}',
        },
      },
    ],
  })

  assertEquals(result.plan.runId, 'run-order')
  assertEquals(order.slice(0, 4), [
    'fetch:run-order',
    'parse:run-order:fetch',
    'run.insert',
    'item.insertMany',
  ])
})

test('[flow] R07 runSourceUseCase: 应在边界处收口 run/item/attempt 聚合与失败终态', async () => {
  const createdRuns: Array<Record<string, unknown>> = []
  const updatedRuns: Array<Record<string, unknown>> = []
  const insertedItems: string[] = []
  const itemStatuses: Array<{ itemId: string; status: string; skippedReason?: string }> = []
  const plannedAttempts: string[] = []
  const finishedAttempts: Array<{
    attemptId: string
    result: {
      status: 'delivered' | 'failed'
      reason?: string
      startedAt: string
      finishedAt: string
    }
  }> = []

  const nowValues = [
    '2026-04-13T11:00:00.000Z',
    '2026-04-13T11:00:01.000Z',
    '2026-04-13T11:00:02.000Z',
    '2026-04-13T11:00:03.000Z',
    '2026-04-13T11:00:04.000Z',
    '2026-04-13T11:00:05.000Z',
  ]

  const useCase = new RunSourceUseCase({
    now: () => nowValues.shift() ?? '2026-04-13T11:00:05.000Z',
    createRunId: () => 'run-1',
    createItemId: (entry) => `item:${entry.id}`,
    sourceInputGateway: {
      fetch: () =>
        Promise.resolve({
          kind: 'fetch',
          collectedAt: '2026-04-13T11:00:00.000Z',
          payloadSummary: { hash: 'hash-1', bytes: 10 },
        }),
    },
    sourceParser: {
      parse: () =>
        Promise.resolve({
          sourceKind: 'fetch',
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [
            {
              id: 'entry-1',
              title: 'Hello',
              link: '',
              description: '',
              content: '',
              published: '',
              updated: '',
            },
          ],
        }),
    },
    runRepository: {
      insert: (run) => {
        createdRuns.push(run as unknown as Record<string, unknown>)
        return Promise.resolve()
      },
      update: (run) => {
        updatedRuns.push(run as unknown as Record<string, unknown>)
        return Promise.resolve()
      },
    },
    itemRepository: {
      insertMany: (items) => {
        insertedItems.push(...items.map((item) => item.itemId))
        return Promise.resolve()
      },
      updateStatus: (itemId, status, skippedReason) => {
        itemStatuses.push({ itemId, status, skippedReason })
        return Promise.resolve()
      },
    },
    deliveryAttemptRepository: {
      insertPlanned: (attempt) => {
        plannedAttempts.push(attempt.deliveryId)
        return Promise.resolve()
      },
      finish: (attemptId, result) => {
        finishedAttempts.push({ attemptId, result })
        return Promise.resolve()
      },
    },
    deduplicationRepository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: ({ deliveryId }) => Promise.resolve(deliveryId === 'archive'),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
    deliveryExecutors: {
      push: {
        execute: () => Promise.reject(new Error('telegram 500')),
      },
      file: {
        execute: () => Promise.resolve(),
      },
      email: {
        execute: () => Promise.resolve(),
      },
    },
  })

  const result = await useCase.execute({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    bindings: [
      {
        sourceId: 'rust',
        deliveryId: 'archive',
        definition: {
          kind: 'file',
          deliveryId: 'archive',
          path: '/tmp/archive.txt',
          contentTemplate: '{{ entry.title }}',
        },
      },
      {
        sourceId: 'rust',
        deliveryId: 'telegram',
        definition: {
          kind: 'push',
          deliveryId: 'telegram',
          http: {
            method: 'POST',
            url: 'https://example.com/telegram',
          },
          requestType: 'body',
          payloadTemplate: { text: '{{ entry.title }}' },
        },
      },
    ],
  })

  assertEquals(result.plan.runId, 'run-1')
  assertEquals(createdRuns.length, 1)
  assertEquals(createdRuns[0]?.runId, 'run-1')
  assertEquals(insertedItems, ['item:entry-1'])
  assertEquals(plannedAttempts, ['telegram'])
  assertEquals(finishedAttempts, [
    {
      attemptId: 'run-1:item:entry-1:telegram',
      result: {
        status: 'failed',
        reason: 'telegram 500',
        startedAt: '2026-04-13T11:00:03.000Z',
        finishedAt: '2026-04-13T11:00:04.000Z',
      },
    },
  ])
  assertEquals(itemStatuses, [
    { itemId: 'item:entry-1', status: 'failed', skippedReason: undefined },
  ])
  assertEquals(updatedRuns.length, 1)
  assertEquals(updatedRuns[0]?.status, 'failed')
})

test('[contract] runSourceUseCase: item 落库失败时应回写 failed run', async () => {
  const runStatuses: string[] = []

  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T11:50:00.000Z',
    createRunId: () => 'run-failed-finalize',
    sourceInputGateway: {
      fetch: () =>
        Promise.resolve({
          kind: 'fetch',
          collectedAt: '2026-04-13T11:50:00.000Z',
          payloadSummary: { hash: 'hash-failed-finalize', bytes: 10 },
        }),
    },
    sourceParser: {
      parse: () =>
        Promise.resolve({
          sourceKind: 'fetch',
          parser: 'rss',
          diagnostics: [],
          feed: {
            title: 'Feed',
            link: '',
            description: '',
            generator: '',
            language: '',
            published: '',
          },
          items: [],
        }),
    },
    runRepository: {
      insert: () => Promise.resolve(),
      update: (run) => {
        runStatuses.push(run.status)
        return Promise.resolve()
      },
    },
    itemRepository: {
      insertMany: () => Promise.reject(new Error('persist boom')),
      updateStatus: () => Promise.resolve(),
    },
    deliveryAttemptRepository: {
      insertPlanned: () => Promise.resolve(),
      finish: () => Promise.resolve(),
    },
    deduplicationRepository: {
      isItemDuplicate: () => Promise.resolve(false),
      registerItemFingerprint: () => Promise.resolve(),
      isDeliveryDuplicate: () => Promise.resolve(false),
      registerDeliveryFingerprint: () => Promise.resolve(),
    },
    deliveryExecutors: {
      push: { execute: () => Promise.resolve() },
      file: { execute: () => Promise.resolve() },
      email: { execute: () => Promise.resolve() },
    },
  })

  await assertRejects(
    () =>
      useCase.execute({
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
      }),
    Error,
    'persist boom',
  )

  assertEquals(runStatuses, ['failed'])
})
