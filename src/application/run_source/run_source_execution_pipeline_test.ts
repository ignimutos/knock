import { assertEquals } from '../../testing/assert.ts'
import type { UnifiedEntryFields } from '../../config/types.ts'
import type { SourceRun } from '../../domain/source_run.ts'
import { test } from '../../testing/test_api.ts'
import { createRunSourceLifecycle } from './create_run_source_lifecycle.ts'
import { RunSourceExecutionPipeline } from './run_source_execution_pipeline.ts'

function createContext(input?: {
  onRunInsert?: () => void
  onRunUpdate?: (run: SourceRun) => void
  onItemInsertMany?: () => void
  shouldPassFilter?: (item: UnifiedEntryFields) => boolean
}) {
  const shouldPassFilter = input?.shouldPassFilter

  return {
    now: () => '2026-04-13T11:00:00.000Z',
    createItemId: (entry: UnifiedEntryFields) => `item:${entry.id}`,
    createAttemptId: (request: { sourceRunId: string; itemId: string; deliveryId: string }) =>
      `${request.sourceRunId}:${request.itemId}:${request.deliveryId}`,
    runRepository: {
      insert: () => {
        input?.onRunInsert?.()
        return Promise.resolve()
      },
      update: (run: SourceRun) => {
        input?.onRunUpdate?.(run)
        return Promise.resolve()
      },
    },
    itemRepository: {
      insertMany: () => {
        input?.onItemInsertMany?.()
        return Promise.resolve()
      },
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
    deliveryExecutors: {},
    renderContent: (template: string) => Promise.resolve(template),
    renderPayload: (payload: unknown) => Promise.resolve(payload),
    shouldPassFilter: shouldPassFilter
      ? ({ item }: { item: UnifiedEntryFields }) => Promise.resolve(shouldPassFilter(item))
      : undefined,
    logger: undefined,
  }
}

function createCollected(input?: { filter?: string; items?: UnifiedEntryFields[] }) {
  return {
    plan: {
      runId: 'run-1',
      source: {
        kind: 'fetch' as const,
        sourceId: 'rust',
        fetcher: 'http' as const,
        parser: 'syndication' as const,
        ...(input?.filter ? { filter: input.filter } : {}),
      },
      profile: 'production' as const,
      effectDomain: 'production' as const,
      trigger: 'scheduled' as const,
      scheduledAt: '2026-04-13T11:00:00.000Z',
      bindings: [],
    },
    fetchedInput: {
      kind: 'fetch' as const,
      collectedAt: '2026-04-13T11:00:00.000Z',
      payloadSummary: {
        hash: 'hash-1',
        bytes: 10,
      },
    },
    parsed: {
      sourceKind: 'fetch' as const,
      parser: 'rss' as const,
      diagnostics: [],
      feed: {
        title: 'Feed',
        link: '',
        description: '',
        generator: '',
        language: '',
        published: '',
      },
      items: input?.items ?? [],
    },
  }
}

test('[unit] runSourceExecutionPipeline: 应串联 persist -> materialize -> finalize', async () => {
  const order: string[] = []
  const context = createContext({
    onRunInsert: () => order.push('run.insert'),
    onItemInsertMany: () => order.push('item.insertMany'),
    onRunUpdate: () => order.push('run.update'),
  })

  await new RunSourceExecutionPipeline({
    collected: createCollected(),
    context,
    lifecycle: createRunSourceLifecycle(context),
  }).run()

  assertEquals(order, ['run.insert', 'item.insertMany', 'run.update'])
})

test('[unit] runSourceExecutionPipeline: 应把 item 结果累加到 finalized run counts 与 lifecycle counts', async () => {
  let updatedRun: SourceRun | undefined
  const context = createContext({
    onRunUpdate: (run) => {
      updatedRun = run
    },
    shouldPassFilter: (item) => item.id !== 'filtered',
  })

  const lifecycleCounts = await new RunSourceExecutionPipeline({
    collected: createCollected({
      filter: '{{ true }}',
      items: [
        {
          id: 'filtered',
          title: 'Filtered',
          link: '',
          description: '',
          content: '',
          published: '',
          updated: '',
        },
        {
          id: 'skipped',
          title: 'Skipped',
          link: '',
          description: '',
          content: '',
          published: '',
          updated: '',
        },
      ],
    }),
    context,
    lifecycle: createRunSourceLifecycle(context),
  }).run()

  assertEquals(lifecycleCounts, {
    filteredCount: 1,
    dedupedCount: 0,
    pushedCount: 0,
    failedCount: 0,
  })
  assertEquals(updatedRun?.counts, {
    fetchedCount: 2,
    parsedCount: 2,
    filteredCount: 1,
    duplicateItemCount: 0,
    deliveredCount: 0,
    failedAttemptCount: 0,
    skippedCount: 1,
  })
})
