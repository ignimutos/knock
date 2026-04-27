import { assertEquals } from '@std/assert'
import type { UnifiedFeedFields } from '../config/types.ts'
import { createLogger, type Logger } from '../core/logger.ts'
import type { DeliveryAttempt, RenderedSnapshot } from '../domain/delivery_attempt.ts'
import { createPipelineItem, type PipelineItem } from '../domain/pipeline_item.ts'
import { createRunPlan, type DeliveryBinding, type RunPlan } from '../domain/run_plan.ts'
import type { DeliveryExecutorRegistry, DeliveryAttemptPlan } from './ports/delivery_executor.ts'
import { RunSourceItemPipeline } from './run_source_item_pipeline.ts'
import { DeduplicationStage } from './stages/deduplication_stage.ts'
import { FilterStage } from './stages/filter_stage.ts'
import { RenderStage } from './stages/render_stage.ts'
import { test } from '../testing/test_api.ts'

// risk-id: R07
// layer: contract

interface PipelineHarnessOptions {
  now?: () => string
  plan?: RunPlan
  feed?: UnifiedFeedFields
  shouldPassFilter?: (input: { item: PipelineItem; filterTemplate?: string }) => Promise<boolean>
  isItemDuplicate?: () => Promise<boolean>
  isDeliveryDuplicate?: (input: { deliveryId: string; fingerprint: string }) => Promise<boolean>
  renderContent?: (template: string, context: Record<string, unknown>) => Promise<string>
  renderPayload?: (payload: unknown, context: Record<string, unknown>) => Promise<unknown>
  executors?: Partial<DeliveryExecutorRegistry>
  logger?: Logger
  deliveryDispatchLogger?: Logger
}

function createFeed(overrides: Partial<UnifiedFeedFields> = {}): UnifiedFeedFields {
  return {
    title: 'Feed',
    link: '',
    description: '',
    generator: '',
    language: '',
    published: '',
    ...overrides,
  }
}

function createBindings(...bindings: DeliveryBinding[]): DeliveryBinding[] {
  return bindings
}

function createFileBinding(deliveryId = 'archive'): DeliveryBinding {
  return {
    sourceId: 'rust',
    deliveryId,
    definition: {
      kind: 'file',
      deliveryId,
      path: '/tmp/archive.txt',
      contentTemplate: '{{ entry.title }}',
    },
  }
}

function createPushBinding(deliveryId = 'telegram'): DeliveryBinding {
  return {
    sourceId: 'rust',
    deliveryId,
    definition: {
      kind: 'push',
      deliveryId,
      http: {
        method: 'POST',
        url: 'https://example.com/telegram',
      },
      requestType: 'body',
      payloadTemplate: { text: '{{ entry.title }}' },
    },
  }
}

function createEmailBinding(deliveryId = 'mailer'): DeliveryBinding {
  return {
    sourceId: 'rust',
    deliveryId,
    definition: {
      kind: 'email',
      deliveryId,
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      messageTemplate: {
        from: 'bot@example.com',
        to: ['ops@example.com'],
        subject: '{{ entry.title }}',
        text: '{{ entry.description }}',
      },
    },
  }
}

function createPlan(bindings: DeliveryBinding[], filter?: string): RunPlan {
  return createRunPlan({
    runId: 'run-1',
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
      ...(filter ? { filter } : {}),
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    scheduledAt: '2026-04-13T11:00:00.000Z',
    bindings,
  })
}

function createSummaryPlan(bindings: DeliveryBinding[]): RunPlan {
  return createRunPlan({
    runId: 'run-summary',
    source: {
      kind: 'summary',
      sourceId: 'daily',
      upstreamSourceIds: ['rust'],
      filter: '{{ entry.title == "Hello" }}',
    },
    profile: 'preview',
    effectDomain: 'preview',
    trigger: 'preview',
    scheduledAt: '2026-04-13T11:25:00.000Z',
    bindings,
  })
}

function createItem(entryId = 'entry-1', title = 'Hello'): PipelineItem {
  return createPipelineItem({
    itemId: `item:${entryId}`,
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: entryId,
      title,
      link: '',
      description: title === 'Hello' ? 'Desc' : '',
      content: '',
      published: '',
      updated: '',
    },
  })
}

function createSummaryItem(entryId = 'entry-1', title = 'Hello'): PipelineItem {
  return createPipelineItem({
    itemId: `item:${entryId}`,
    sourceRunId: 'run-summary',
    sourceId: 'daily',
    effectDomain: 'preview',
    normalized: {
      id: entryId,
      title,
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const value = lookupTemplateValue(context, expression.trim())
    return value === undefined || value === null ? '' : String(value)
  })
}

function renderPayloadTemplate(payload: unknown, context: Record<string, unknown>): unknown {
  if (typeof payload === 'string') {
    return renderTemplate(payload, context)
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (typeof item === 'string' || Array.isArray(item) || (item && typeof item === 'object')) {
        return renderPayloadTemplate(item, context)
      }
      return item
    })
  }

  if (!payload || typeof payload !== 'object') {
    return payload
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (
        typeof value === 'string' ||
        Array.isArray(value) ||
        (value && typeof value === 'object')
      ) {
        return [key, renderPayloadTemplate(value, context)]
      }
      return [key, value]
    }),
  )
}

function lookupTemplateValue(context: Record<string, unknown>, expression: string): unknown {
  const segments = expression.split('.')
  let current: unknown = context
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function createPipelineHarness(options: PipelineHarnessOptions = {}) {
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
  const itemStatuses: Array<{
    itemId: string
    status: PipelineItem['status']
    skippedReason?: string
  }> = []
  const registeredItemFingerprints: Array<{
    sourceId: string
    effectDomain: 'production' | 'preview'
    fingerprint: string
    recordedAt: string
  }> = []
  const registeredDeliveryFingerprints: Array<{
    sourceId: string
    deliveryId: string
    effectDomain: 'production' | 'preview'
    fingerprint: string
    recordedAt: string
  }> = []
  let itemDuplicateChecks = 0
  let deliveryDuplicateChecks = 0
  const executedPlans: DeliveryAttemptPlan[] = []

  const now = options.now ?? (() => '2026-04-13T11:00:00.000Z')
  const bindings = options.plan?.bindings ?? createBindings(createFileBinding())
  const plan = options.plan ?? createPlan(bindings)
  const feed = options.feed ?? createFeed()
  const logger = options.logger
  const deliveryDispatchLogger =
    options.deliveryDispatchLogger ?? logger?.child({ module: 'delivery.runtime.dispatch' })

  const deliveryExecutors: Partial<DeliveryExecutorRegistry> = options.executors ?? {
    file: {
      execute: (plan) => {
        executedPlans.push(plan)
        return Promise.resolve()
      },
    },
    push: {
      execute: (plan) => {
        executedPlans.push(plan)
        return Promise.resolve()
      },
    },
    email: {
      execute: (plan) => {
        executedPlans.push(plan)
        return Promise.resolve()
      },
    },
  }

  const itemRepository = {
    insertMany: () => Promise.resolve(),
    updateStatus: (itemId: string, status: PipelineItem['status'], skippedReason?: string) => {
      itemStatuses.push({ itemId, status, skippedReason })
      return Promise.resolve()
    },
  }

  const deliveryAttemptRepository = {
    insertPlanned: (attempt: DeliveryAttempt) => {
      plannedAttempts.push(attempt)
      return Promise.resolve()
    },
    finish: (
      attemptId: string,
      result: {
        status: 'delivered' | 'failed'
        reason?: string
        startedAt: string
        finishedAt: string
      },
    ) => {
      finishedAttempts.push({ attemptId, result })
      return Promise.resolve()
    },
  }

  const deduplicationRepository = {
    isItemDuplicate: () => {
      itemDuplicateChecks += 1
      return options.isItemDuplicate?.() ?? Promise.resolve(false)
    },
    registerItemFingerprint: (input: {
      sourceId: string
      effectDomain: 'production' | 'preview'
      fingerprint: string
      recordedAt: string
    }) => {
      registeredItemFingerprints.push(input)
      return Promise.resolve()
    },
    isDeliveryDuplicate: (input: {
      deliveryId: string
      fingerprint: string
      sourceId: string
      effectDomain: 'production' | 'preview'
    }) => {
      deliveryDuplicateChecks += 1
      return options.isDeliveryDuplicate?.(input) ?? Promise.resolve(false)
    },
    registerDeliveryFingerprint: (input: {
      sourceId: string
      deliveryId: string
      effectDomain: 'production' | 'preview'
      fingerprint: string
      recordedAt: string
    }) => {
      registeredDeliveryFingerprints.push(input)
      return Promise.resolve()
    },
  }

  const pipeline = new RunSourceItemPipeline({
    now,
    plan,
    feed,
    bindings,
    deliveryIds: bindings.map((binding) => binding.deliveryId),
    filterStage: new FilterStage({
      shouldPassFilter: options.shouldPassFilter,
    }),
    deduplicationStage: new DeduplicationStage({
      repository: deduplicationRepository,
    }),
    renderStage: new RenderStage({
      now,
      createAttemptId: ({ sourceRunId, itemId, deliveryId }) =>
        `${sourceRunId}:${itemId}:${deliveryId}`,
      renderContent: (template, context) =>
        options.renderContent?.(template, context) ??
        Promise.resolve(renderTemplate(template, context)),
      renderPayload: (payload, context) =>
        options.renderPayload?.(payload, context) ??
        Promise.resolve(renderPayloadTemplate(payload, context)),
    }),
    itemRepository,
    deliveryAttemptRepository,
    deduplicationRepository,
    deliveryExecutors,
    logger,
    deliveryDispatchLogger,
  })

  return {
    pipeline,
    plannedAttempts,
    finishedAttempts,
    itemStatuses,
    registeredItemFingerprints,
    registeredDeliveryFingerprints,
    getItemDuplicateChecks: () => itemDuplicateChecks,
    getDeliveryDuplicateChecks: () => deliveryDuplicateChecks,
    executedPlans,
  }
}

test('[flow] R07 runSourceItemPipeline: 双层 dedupe、rendered snapshot 与 attempt 失败归属应串成最小主链', async () => {
  const nowValues = [
    '2026-04-13T11:00:02.000Z',
    '2026-04-13T11:00:03.000Z',
    '2026-04-13T11:00:04.000Z',
    '2026-04-13T11:00:05.000Z',
  ]
  const harness = createPipelineHarness({
    now: () => nowValues.shift() ?? '2026-04-13T11:00:05.000Z',
    plan: createPlan(createBindings(createFileBinding('archive'), createPushBinding('telegram'))),
    isDeliveryDuplicate: ({ deliveryId }) => Promise.resolve(deliveryId === 'archive'),
    executors: {
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

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.plannedAttempts.length, 1)
  assertEquals(harness.plannedAttempts[0]?.deliveryId, 'telegram')
  assertEquals(harness.plannedAttempts[0]?.renderedSnapshot, {
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
  assertEquals(harness.finishedAttempts, [
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
  assertEquals(harness.itemStatuses, [
    { itemId: 'item:entry-1', status: 'failed', skippedReason: undefined },
  ])
  assertEquals(result.counts, {
    filteredCount: 0,
    duplicateItemCount: 0,
    deliveredCount: 0,
    failedAttemptCount: 1,
    skippedCount: 0,
  })
  assertEquals(result.lifecycleCounts, {
    filteredCount: 0,
    dedupedCount: 1,
    pushedCount: 0,
    failedCount: 1,
  })
})

test('[contract] R07 runSourceItemPipeline: email delivery 应把 canonical rendered payload 贯通到 attempt plan', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createEmailBinding())),
  })

  const result = await harness.pipeline.run(createItem())

  const expectedSnapshot = {
    channel: 'email',
    payload: {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      message: {
        from: 'bot@example.com',
        to: ['ops@example.com'],
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        subject: 'Hello',
        text: 'Desc',
        headers: undefined,
      },
    },
  } satisfies RenderedSnapshot

  assertEquals(
    harness.plannedAttempts.map((attempt) => attempt.renderedSnapshot),
    [expectedSnapshot],
  )
  assertEquals(
    harness.executedPlans.map((plan) => plan.renderedSnapshot),
    [expectedSnapshot],
  )
  assertEquals(result.counts.deliveredCount, 1)
})

test('[contract] R06 runSourceItemPipeline: filter 命中时应把 item 标记为 filtered 且不给 skippedReason', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createFileBinding()), '{{ entry.title == "Hello" }}'),
    shouldPassFilter: ({ item, filterTemplate }) => {
      assertEquals(item.normalized.title, 'Hello')
      assertEquals(filterTemplate, '{{ entry.title == "Hello" }}')
      return Promise.resolve(false)
    },
  })

  await harness.pipeline.run(createItem())

  assertEquals(harness.itemStatuses, [
    { itemId: 'item:entry-1', status: 'filtered', skippedReason: undefined },
  ])
})

test('[flow] R06 runSourceItemPipeline: filter 命中时应短路 dedupe 与 delivery', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createFileBinding()), '{{ entry.title == "Hello" }}'),
    shouldPassFilter: ({ item, filterTemplate }) => {
      assertEquals(item.normalized.title, 'Hello')
      assertEquals(filterTemplate, '{{ entry.title == "Hello" }}')
      return Promise.resolve(false)
    },
  })

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.itemStatuses, [
    { itemId: 'item:entry-1', status: 'filtered', skippedReason: undefined },
  ])
  assertEquals(harness.getItemDuplicateChecks(), 0)
  assertEquals(harness.plannedAttempts.length, 0)
  assertEquals(result.counts, {
    filteredCount: 1,
    duplicateItemCount: 0,
    deliveredCount: 0,
    failedAttemptCount: 0,
    skippedCount: 0,
  })
})

test('[contract] R07 runSourceItemPipeline: owner-scoped item 日志应覆盖 filter/dedupe/dispatch', async () => {
  const logs: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'scheduler.source',
    now: () => new Date('2026-04-13T11:50:00.000Z'),
    writeStdout: (line: string) => logs.push(line),
    writeWarn: (line: string) => logs.push(line),
    writeStderr: (line: string) => logs.push(line),
  })

  const harness = createPipelineHarness({
    logger,
    plan: createPlan(createBindings(createFileBinding()), '{{ true }}'),
    shouldPassFilter: ({ item }) => Promise.resolve(item.normalized.id !== 'entry-filtered'),
    isDeliveryDuplicate: ({ fingerprint }) => Promise.resolve(fingerprint === 'entry-deduped'),
  })

  await harness.pipeline.run(createItem('entry-filtered', 'Filtered'))
  await harness.pipeline.run(createItem('entry-deduped', 'Deduped'))
  await harness.pipeline.run(createItem('entry-delivered', 'Delivered'))

  const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
  const filterLog = records.find((record) => {
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'pipeline.filter' &&
      attributes['pipeline.operation'] === 'filter' &&
      attributes['pipeline.outcome'] === 'filtered'
    )
  })
  const dedupeLog = records.find((record) => {
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'delivery.store' &&
      attributes['delivery.operation'] === 'is_delivered' &&
      attributes['delivery.outcome'] === 'deduped'
    )
  })
  const dispatchLog = records.find((record) => {
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    return (
      scope.name === 'delivery.runtime.dispatch' &&
      attributes['delivery.operation'] === 'dispatch' &&
      attributes['delivery.outcome'] === 'success'
    )
  })

  assertEquals(Boolean(filterLog), true)
  assertEquals(Boolean(dedupeLog), true)
  assertEquals(Boolean(dispatchLog), true)

  const filterAttributes = (filterLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(filterAttributes['source.id'], 'rust')
  assertEquals(filterAttributes['source.run_id'], 'run-1')
  assertEquals(filterAttributes['pipeline.item_id'], 'item:entry-filtered')

  const dedupeAttributes = (dedupeLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(dedupeAttributes['source.id'], 'rust')
  assertEquals(dedupeAttributes['source.run_id'], 'run-1')
  assertEquals(dedupeAttributes['pipeline.item_id'], 'item:entry-deduped')
  assertEquals(dedupeAttributes['delivery.id'], 'archive')

  const dispatchAttributes = (dispatchLog?.attributes ?? {}) as Record<string, unknown>
  assertEquals(dispatchAttributes['delivery.id'], 'archive')
  assertEquals(dispatchAttributes['pipeline.item_id'], 'item:entry-delivered')
})

test('[contract] R07 runSourceItemPipeline: item 为 new 但全部 delivery duplicate 时应落 skipped', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createFileBinding())),
    isDeliveryDuplicate: () => Promise.resolve(true),
  })

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.itemStatuses, [
    {
      itemId: 'item:entry-1',
      status: 'skipped' as PipelineItem['status'],
      skippedReason: 'all_deliveries_duplicate',
    },
  ])
  assertEquals(result.counts.skippedCount, 1)
  assertEquals(result.lifecycleCounts.dedupedCount, 1)
})

test('[contract] R07 runSourceItemPipeline: no bindings 时应落 skipped/no_deliveries', async () => {
  const harness = createPipelineHarness({
    plan: createPlan([]),
  })

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.plannedAttempts.length, 0)
  assertEquals(harness.itemStatuses, [
    {
      itemId: 'item:entry-1',
      status: 'skipped' as PipelineItem['status'],
      skippedReason: 'no_deliveries',
    },
  ])
  assertEquals(result.counts.skippedCount, 1)
})

test('[contract] R07 runSourceItemPipeline: delivered 后应注册 item fingerprint', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createFileBinding())),
  })

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.registeredItemFingerprints, [
    {
      sourceId: 'rust',
      effectDomain: 'production',
      fingerprint: 'entry-1',
      recordedAt: '2026-04-13T11:00:00.000Z',
    },
  ])
  assertEquals(harness.itemStatuses, [
    {
      itemId: 'item:entry-1',
      status: 'delivered' as PipelineItem['status'],
      skippedReason: undefined,
    },
  ])
  assertEquals(result.counts.deliveredCount, 1)
})

test('[contract] R07 runSourceItemPipeline: summary item 也应接入 filter 主链', async () => {
  let filterCalls = 0
  const harness = createPipelineHarness({
    plan: createSummaryPlan([]),
    feed: createFeed({ title: 'Summary Feed' }),
    shouldPassFilter: ({ item, filterTemplate }) => {
      filterCalls += 1
      assertEquals(item.normalized.title, 'Hello')
      assertEquals(filterTemplate, '{{ entry.title == "Hello" }}')
      return Promise.resolve(false)
    },
  })

  const result = await harness.pipeline.run(createSummaryItem())

  assertEquals(filterCalls, 1)
  assertEquals(harness.itemStatuses, [
    { itemId: 'item:entry-1', status: 'filtered', skippedReason: undefined },
  ])
  assertEquals(result.counts.filteredCount, 1)
})

test('[contract] R07 runSourceItemPipeline: item duplicate 时不应进入 delivery 计划与发送', async () => {
  const harness = createPipelineHarness({
    plan: createPlan(createBindings(createFileBinding())),
    isItemDuplicate: () => Promise.resolve(true),
  })

  const result = await harness.pipeline.run(createItem())

  assertEquals(harness.getDeliveryDuplicateChecks(), 0)
  assertEquals(harness.plannedAttempts.length, 0)
  assertEquals(harness.finishedAttempts.length, 0)
  assertEquals(harness.executedPlans.length, 0)
  assertEquals(harness.itemStatuses, [
    { itemId: 'item:entry-1', status: 'duplicate', skippedReason: undefined },
  ])
  assertEquals(result.counts.duplicateItemCount, 1)
})
