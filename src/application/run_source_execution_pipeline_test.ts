import { assertEquals, assertRejects } from '@std/assert'
import type { DeliveryAttempt } from '../domain/delivery_attempt.ts'
import type { PipelineItem } from '../domain/pipeline_item.ts'
import type { SourceRun } from '../domain/source_run.ts'
import { createRunPlan } from '../domain/run_plan.ts'
import { RunSourceExecutionPipeline } from './run_source_execution_pipeline.ts'

Deno.test(
  '[contract] runSourceExecutionPipeline: 应收口 run/item/attempt 聚合与失败终态',
  async () => {
    const createdRuns: SourceRun[] = []
    const updatedRuns: SourceRun[] = []
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

    const nowValues = [
      '2026-04-13T11:00:00.000Z',
      '2026-04-13T11:00:01.000Z',
      '2026-04-13T11:00:02.000Z',
      '2026-04-13T11:00:03.000Z',
      '2026-04-13T11:00:04.000Z',
      '2026-04-13T11:00:05.000Z',
      '2026-04-13T11:00:06.000Z',
    ]

    const lifecycle = await new RunSourceExecutionPipeline({
      now: () => nowValues.shift() ?? '2026-04-13T11:00:06.000Z',
      plan: createRunPlan({
        runId: 'run-1',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T11:00:00.000Z',
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
      }),
      parsed: {
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
      },
      createItemId: (entry) => `item:${entry.id}`,
      runRepository: {
        insert: (run) => {
          createdRuns.push(run)
          return Promise.resolve()
        },
        update: (run) => {
          updatedRuns.push(run)
          return Promise.resolve()
        },
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
    }).run()

    assertEquals(createdRuns.length, 1)
    assertEquals(createdRuns[0]?.runId, 'run-1')
    assertEquals(
      insertedItems.map((item) => item.itemId),
      ['item:entry-1'],
    )
    assertEquals(plannedAttempts.length, 1)
    assertEquals(plannedAttempts[0]?.deliveryId, 'telegram')
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
    assertEquals(lifecycle, {
      filteredCount: 0,
      dedupedCount: 1,
      pushedCount: 0,
      failedCount: 1,
    })
  },
)

Deno.test('[contract] runSourceExecutionPipeline: item 落库失败时应回写 failed run', async () => {
  const runStatuses: string[] = []

  await assertRejects(
    () =>
      new RunSourceExecutionPipeline({
        now: () => '2026-04-13T11:50:00.000Z',
        plan: createRunPlan({
          runId: 'run-failed-finalize',
          source: {
            kind: 'fetch',
            sourceId: 'rust',
            fetcher: 'http',
            parser: 'syndication',
          },
          profile: 'production',
          effectDomain: 'production',
          trigger: 'scheduled',
          scheduledAt: '2026-04-13T11:50:00.000Z',
          bindings: [],
        }),
        parsed: {
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
        },
        createItemId: (entry) => `item:${entry.id}`,
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
      }).run(),
    Error,
    'persist boom',
  )

  assertEquals(runStatuses, ['failed'])
})
