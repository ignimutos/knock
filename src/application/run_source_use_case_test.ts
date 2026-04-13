import { assertEquals, assertRejects } from '@std/assert'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DeliveryAttempt, RenderedSnapshot } from '../domain/delivery_attempt.ts'
import type { PipelineItem } from '../domain/pipeline_item.ts'
import type { SourceRun } from '../domain/source_run.ts'
import type { SourceParser } from './ports/source_parser.ts'
import type { SourceInputGateway } from './ports/source_input_gateway.ts'
import { RunSourceUseCase } from './run_source_use_case.ts'

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
  })
}

Deno.test('runSourceUseCase: summary 与 fetch source 应共享主生命周期入口', async () => {
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

Deno.test('runSourceUseCase: 应生成可复用的 RunPlan 并保留 bindings', async () => {
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

Deno.test(
  'runSourceUseCase: 双层 dedupe、rendered snapshot 与 attempt 失败归属应串成最小主链',
  async () => {
    const createdRuns: SourceRun[] = []
    const insertedItems: PipelineItem[] = []
    const itemStatuses: Array<{
      itemId: string
      status: PipelineItem['status']
      skippedReason?: string
    }> = []
    const plannedAttempts: DeliveryAttempt[] = []
    const finishedAttempts: Array<{
      attemptId: string
      result: {
        status: 'delivered' | 'failed'
        reason?: string
        startedAt: string
        finishedAt: string
      }
    }> = []

    const useCase = new RunSourceUseCase({
      now: (() => {
        const values = [
          '2026-04-13T11:00:00.000Z',
          '2026-04-13T11:00:01.000Z',
          '2026-04-13T11:00:02.000Z',
          '2026-04-13T11:00:03.000Z',
          '2026-04-13T11:00:04.000Z',
          '2026-04-13T11:00:05.000Z',
          '2026-04-13T11:00:06.000Z',
        ]
        return () => values.shift() ?? '2026-04-13T11:00:06.000Z'
      })(),
      createRunId: () => 'run-1',
      createItemId: (entry) => `item:${entry.id}`,
      sourceInputGateway: {
        fetch: (plan) =>
          Promise.resolve({
            kind: plan.source.kind,
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
          createdRuns.push(run)
          return Promise.resolve()
        },
        update: () => Promise.resolve(),
      },
      itemRepository: {
        insertMany: (items) => {
          insertedItems.push(...items)
          return Promise.resolve()
        },
        updateStatus: (itemId, status, skippedReason) => {
          itemStatuses.push({ itemId, status, skippedReason })
          return Promise.resolve()
        },
      },
      deliveryAttemptRepository: {
        insertPlanned: (attempt) => {
          plannedAttempts.push(attempt)
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

    assertEquals(createdRuns.length, 1)
    assertEquals(createdRuns[0]?.runId, 'run-1')
    assertEquals(insertedItems.length, 1)
    assertEquals(insertedItems[0]?.itemId, 'item:entry-1')
    assertEquals(plannedAttempts.length, 1)
    assertEquals(plannedAttempts[0]?.deliveryId, 'telegram')
    assertEquals(plannedAttempts[0]?.renderedSnapshot, {
      channel: 'push',
      payload: {
        http: {
          method: 'POST',
          url: 'https://example.com/telegram',
        },
        requestType: 'body',
        payload: {
          text: 'Hello',
        },
        response: undefined,
      },
    } satisfies RenderedSnapshot)
    assertEquals(finishedAttempts, [
      {
        attemptId: 'run-1:item:entry-1:telegram',
        result: {
          status: 'failed',
          reason: 'telegram 500',
          startedAt: '2026-04-13T11:00:04.000Z',
          finishedAt: '2026-04-13T11:00:05.000Z',
        },
      },
    ])
    assertEquals(itemStatuses, [
      { itemId: 'item:entry-1', status: 'failed', skippedReason: undefined },
    ])
    assertEquals(result.parsed.items.length, 1)
  },
)

Deno.test(
  'runSourceUseCase: source filter 命中时应落 filtered，而不是继续进入 dedupe/delivery',
  async () => {
    const itemStatuses: Array<{
      itemId: string
      status: PipelineItem['status']
      skippedReason?: string
    }> = []
    let itemDuplicateChecks = 0
    let plannedAttemptCount = 0

    const useCase = new RunSourceUseCase({
      now: () => '2026-04-13T11:20:00.000Z',
      createRunId: () => 'run-filter',
      createItemId: (entry) => `item:${entry.id}`,
      sourceInputGateway: {
        fetch: (plan) =>
          Promise.resolve({
            kind: plan.source.kind,
            collectedAt: '2026-04-13T11:20:00.000Z',
            payloadSummary: { hash: 'hash-filter', bytes: 10 },
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
      runRepository: { insert: () => Promise.resolve(), update: () => Promise.resolve() },
      itemRepository: {
        insertMany: () => Promise.resolve(),
        updateStatus: (itemId, status, skippedReason) => {
          itemStatuses.push({ itemId, status, skippedReason })
          return Promise.resolve()
        },
      },
      deliveryAttemptRepository: {
        insertPlanned: () => {
          plannedAttemptCount += 1
          return Promise.resolve()
        },
        finish: () => Promise.resolve(),
      },
      deduplicationRepository: {
        isItemDuplicate: () => {
          itemDuplicateChecks += 1
          return Promise.resolve(false)
        },
        registerItemFingerprint: () => Promise.resolve(),
        isDeliveryDuplicate: () => Promise.resolve(false),
        registerDeliveryFingerprint: () => Promise.resolve(),
      },
      deliveryExecutors: {
        push: { execute: () => Promise.resolve() },
        file: { execute: () => Promise.resolve() },
        email: { execute: () => Promise.resolve() },
      },
      shouldPassFilter: ({ item, filterTemplate, source, feed }) => {
        assertEquals(item.title, 'Hello')
        assertEquals(feed.title, 'Feed')
        assertEquals(source.id, 'rust')
        assertEquals(filterTemplate, '{{ entry.title == "Hello" }}')
        return Promise.resolve(false)
      },
    })

    await useCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'syndication',
        filter: '{{ entry.title == "Hello" }}',
      } as SourceDefinition,
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

    assertEquals(itemStatuses, [
      { itemId: 'item:entry-1', status: 'filtered', skippedReason: undefined },
    ])
    assertEquals(itemDuplicateChecks, 0)
    assertEquals(plannedAttemptCount, 0)
  },
)

Deno.test('runSourceUseCase: summary source 也应接入 filter 主链', async () => {
  const itemStatuses: Array<{
    itemId: string
    status: PipelineItem['status']
    skippedReason?: string
  }> = []
  let filterCalls = 0

  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T11:25:00.000Z',
    createRunId: () => 'run-summary-filter',
    createItemId: (entry) => `item:${entry.id}`,
    sourceInputGateway: {
      fetch: (plan) =>
        Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T11:25:00.000Z',
          payloadSummary: { hash: 'hash-summary-filter', bytes: 10 },
        }),
    },
    sourceParser: {
      parse: () =>
        Promise.resolve({
          sourceKind: 'summary',
          parser: 'summary',
          diagnostics: [],
          feed: {
            title: 'Summary Feed',
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
    runRepository: { insert: () => Promise.resolve(), update: () => Promise.resolve() },
    itemRepository: {
      insertMany: () => Promise.resolve(),
      updateStatus: (itemId, status, skippedReason) => {
        itemStatuses.push({ itemId, status, skippedReason })
        return Promise.resolve()
      },
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
    shouldPassFilter: ({ item, filterTemplate, source, feed }) => {
      filterCalls += 1
      assertEquals(item.title, 'Hello')
      assertEquals(feed.title, 'Summary Feed')
      assertEquals(source.id, 'daily')
      assertEquals(filterTemplate, '{{ entry.title == "Hello" }}')
      return Promise.resolve(false)
    },
  })

  await useCase.execute({
    source: {
      kind: 'summary',
      sourceId: 'daily',
      upstreamSourceIds: ['rust'],
      filter: '{{ entry.title == "Hello" }}',
    } as SourceDefinition,
    profile: 'preview',
    effectDomain: 'preview',
    trigger: 'preview',
    bindings: [],
  })

  assertEquals(filterCalls, 1)
  assertEquals(itemStatuses, [
    { itemId: 'item:entry-1', status: 'filtered', skippedReason: undefined },
  ])
})

Deno.test('runSourceUseCase: run insert 后主链抛错时应收口 failed 终态', async () => {
  const runStatuses: string[] = []

  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T11:50:00.000Z',
    createRunId: () => 'run-failed-finalize',
    sourceInputGateway: {
      fetch: (plan) =>
        Promise.resolve({
          kind: plan.source.kind,
          collectedAt: '2026-04-13T11:50:00.000Z',
          payloadSummary: { hash: 'hash-run-failed', bytes: 10 },
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
        bindings: [],
      }),
    Error,
    'persist boom',
  )

  assertEquals(runStatuses, ['failed'])
})

Deno.test(
  'runSourceUseCase: item 为 new 但全部 delivery duplicate 时应保持 item-level 语义分离',
  async () => {
    const itemStatuses: Array<{
      itemId: string
      status: PipelineItem['status']
      skippedReason?: string
    }> = []

    const useCase = new RunSourceUseCase({
      now: () => '2026-04-13T11:30:00.000Z',
      createRunId: () => 'run-dup',
      createItemId: (entry) => `item:${entry.id}`,
      sourceInputGateway: {
        fetch: (plan) =>
          Promise.resolve({
            kind: plan.source.kind,
            collectedAt: '2026-04-13T11:30:00.000Z',
            payloadSummary: { hash: 'hash-dup', bytes: 10 },
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
        insert: () => Promise.resolve(),
        update: () => Promise.resolve(),
      },
      itemRepository: {
        insertMany: () => Promise.resolve(),
        updateStatus: (itemId, status, skippedReason) => {
          itemStatuses.push({ itemId, status, skippedReason })
          return Promise.resolve()
        },
      },
      deliveryAttemptRepository: {
        insertPlanned: () => Promise.resolve(),
        finish: () => Promise.resolve(),
      },
      deduplicationRepository: {
        isItemDuplicate: () => Promise.resolve(false),
        registerItemFingerprint: () => Promise.resolve(),
        isDeliveryDuplicate: () => Promise.resolve(true),
        registerDeliveryFingerprint: () => Promise.resolve(),
      },
      deliveryExecutors: {
        push: { execute: () => Promise.resolve() },
        file: { execute: () => Promise.resolve() },
        email: { execute: () => Promise.resolve() },
      },
    })

    await useCase.execute({
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

    assertEquals(itemStatuses, [
      {
        itemId: 'item:entry-1',
        status: 'skipped' as PipelineItem['status'],
        skippedReason: 'all_deliveries_duplicate',
      },
    ])
  },
)
