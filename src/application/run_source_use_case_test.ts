import { assertEquals, assertRejects } from '@std/assert'
import { createLogger } from '../core/logger.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { DeliveryAttempt } from '../domain/delivery_attempt.ts'
import type { PipelineItem } from '../domain/pipeline_item.ts'
import type { SourceRun } from '../domain/source_run.ts'
import type { SourceParser } from './ports/source_parser.ts'
import type { SourceInputGateway } from './ports/source_input_gateway.ts'
import { RunSourceUseCase, type RunSourceRequest } from './run_source_use_case.ts'

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

Deno.test('[contract] runSourceUseCase: summary 与 fetch source 应共享主生命周期入口', async () => {
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

Deno.test('[contract] runSourceUseCase: 应生成可复用的 RunPlan 并保留 bindings', async () => {
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
  '[flow] R07 runSourceUseCase: 双层 dedupe、rendered snapshot 与 attempt 失败归属应串成最小主链',
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
    })
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
  '[contract] runSourceUseCase: run-level lifecycle logs 应覆盖 start/finalize(success) 与聚合计数',
  async () => {
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
  },
)

Deno.test(
  '[contract] runSourceUseCase: run insert 后主链抛错时应收口 failed 终态并记录 finalize(failure)',
  async () => {
    const runStatuses: string[] = []
    const logs: string[] = []

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
    const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
    const failureFinalizeLog = records.find((record) => {
      const scope = (record.scope ?? {}) as Record<string, unknown>
      const attributes = (record.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'scheduler.source' &&
        attributes['scheduler.operation'] === 'run_source' &&
        attributes['scheduler.outcome'] === 'failure'
      )
    })

    assertEquals(Boolean(failureFinalizeLog), true)
    assertEquals(failureFinalizeLog?.severityText, 'ERROR')
    assertEquals(failureFinalizeLog?.severityNumber, 17)
    const failureAttributes = (failureFinalizeLog?.attributes ?? {}) as Record<string, unknown>
    assertEquals(failureAttributes['source.id'], 'rust')
    assertEquals(failureAttributes['source.run_id'], 'run-failed-finalize')
    assertEquals(failureAttributes['source.item_count'], 0)
    assertEquals(failureAttributes['pipeline.filtered_count'], 0)
    assertEquals(failureAttributes['delivery.deduped_count'], 0)
    assertEquals(failureAttributes['delivery.pushed_count'], 0)
    assertEquals(failureAttributes['delivery.failed_count'], 0)
  },
)

Deno.test('[contract] runSourceUseCase: collect 只应执行 plan、fetch、parse', async () => {
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

Deno.test('[contract] runSourceUseCase: 缺 pipeline deps 时 execute 应 fail fast', async () => {
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

Deno.test('[contract] runSourceUseCase: execute 应先 collect 再 applyCollected', async () => {
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
