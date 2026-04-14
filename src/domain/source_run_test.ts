import { assertEquals, assertThrows } from '@std/assert'
import { assertDeliveryAttemptInvariant, createDeliveryAttempt } from './delivery_attempt.ts'
import { createPipelineItem } from './pipeline_item.ts'
import { createRunPlan } from './run_plan.ts'
import { createSourceRun, finalizeSourceRun } from './source_run.ts'

Deno.test('[unit] domain: finalizeSourceRun 应按 attempt 汇总 success/partial/failed', () => {
  const run = createSourceRun({
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
  })

  const partialRun = finalizeSourceRun(run, {
    fetchedCount: 4,
    parsedCount: 4,
    filteredCount: 1,
    duplicateItemCount: 1,
    deliveredCount: 1,
    failedAttemptCount: 1,
    skippedCount: 0,
    finishedAt: '2026-04-13T09:00:05.000Z',
  })
  assertEquals(partialRun.status, 'partial')
  assertEquals(partialRun.counts.deliveredCount, 1)
  assertEquals(partialRun.counts.failedAttemptCount, 1)
  assertEquals(partialRun.finishedAt, '2026-04-13T09:00:05.000Z')

  const successRun = finalizeSourceRun(run, {
    fetchedCount: 2,
    parsedCount: 2,
    filteredCount: 0,
    duplicateItemCount: 0,
    deliveredCount: 2,
    failedAttemptCount: 0,
    skippedCount: 0,
    finishedAt: '2026-04-13T09:00:06.000Z',
  })
  assertEquals(successRun.status, 'success')

  const failedRun = finalizeSourceRun(run, {
    fetchedCount: 2,
    parsedCount: 2,
    filteredCount: 0,
    duplicateItemCount: 0,
    deliveredCount: 0,
    failedAttemptCount: 2,
    skippedCount: 0,
    finishedAt: '2026-04-13T09:00:07.000Z',
  })
  assertEquals(failedRun.status, 'failed')
})

Deno.test('[unit] domain: preview 与 production effectDomain 必须显式区分', () => {
  const previewItem = createPipelineItem({
    itemId: 'item-preview',
    sourceRunId: 'run-preview',
    sourceId: 'rust',
    effectDomain: 'preview',
    normalized: {
      id: 'entry-1',
      title: 'Preview',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })
  const productionItem = createPipelineItem({
    itemId: 'item-production',
    sourceRunId: 'run-production',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-2',
      title: 'Production',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })
  const previewAttempt = createDeliveryAttempt({
    attemptId: 'attempt-preview',
    itemId: previewItem.itemId,
    sourceRunId: previewItem.sourceRunId,
    deliveryId: 'telegram',
    channel: 'push',
    effectDomain: 'preview',
    plannedAt: '2026-04-13T09:00:02.000Z',
  })
  const productionAttempt = createDeliveryAttempt({
    attemptId: 'attempt-production',
    itemId: productionItem.itemId,
    sourceRunId: productionItem.sourceRunId,
    deliveryId: 'archive',
    channel: 'file',
    effectDomain: 'production',
    plannedAt: '2026-04-13T09:00:03.000Z',
  })

  assertEquals(previewItem.effectDomain, 'preview')
  assertEquals(productionItem.effectDomain, 'production')
  assertEquals(previewAttempt.effectDomain, 'preview')
  assertEquals(productionAttempt.effectDomain, 'production')
})

Deno.test(
  '[unit] domain: finalizeSourceRun 应将无投递且有跳过事实的 run 归类为 skipped 并写入 finishedAt',
  () => {
    const run = createSourceRun({
      runId: 'run-skipped',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      scheduledAt: '2026-04-13T09:10:00.000Z',
      startedAt: '2026-04-13T09:10:01.000Z',
    })

    const skippedRun = finalizeSourceRun(run, {
      fetchedCount: 3,
      parsedCount: 3,
      filteredCount: 2,
      duplicateItemCount: 1,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 0,
      finishedAt: '2026-04-13T09:10:05.000Z',
    })

    assertEquals(skippedRun.status, 'skipped')
    assertEquals(skippedRun.finishedAt, '2026-04-13T09:10:05.000Z')
    assertEquals(skippedRun.counts.skippedCount, 0)
  },
)

Deno.test(
  '[unit] domain: createSourceRun 应拒绝 preview profile 与 production effectDomain 的非法组合',
  () => {
    assertThrows(() =>
      createSourceRun({
        runId: 'run-invalid-profile-domain',
        sourceId: 'rust',
        trigger: 'preview',
        profile: 'preview',
        effectDomain: 'production',
        scheduledAt: '2026-04-13T09:20:00.000Z',
        startedAt: '2026-04-13T09:20:01.000Z',
      }),
    )
  },
)

Deno.test('[unit] domain: createRunPlan 应拒绝非 preview profile 搭配 preview trigger', () => {
  assertThrows(() =>
    createRunPlan({
      runId: 'run-plan-invalid-trigger',
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'syndication',
      },
      profile: 'production',
      effectDomain: 'production',
      trigger: 'preview',
      scheduledAt: '2026-04-13T09:30:00.000Z',
      bindings: [],
    }),
  )
})

Deno.test(
  '[unit] domain: createRunPlan 应拒绝 binding.deliveryId 与 definition.deliveryId 漂移',
  () => {
    assertThrows(() =>
      createRunPlan({
        runId: 'run-plan-invalid-binding-delivery-id',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T09:31:00.000Z',
        bindings: [
          {
            sourceId: 'rust',
            deliveryId: 'archive',
            definition: {
              kind: 'file',
              deliveryId: 'telegram',
              path: '/tmp/out.txt',
              contentTemplate: 'hello',
            },
          },
        ],
      }),
    )
  },
)

Deno.test('[unit] domain: delivery attempt 终态必须与 finishedAt 基本一致', () => {
  assertThrows(() =>
    assertDeliveryAttemptInvariant({
      attemptId: 'attempt-invalid-finished-at',
      itemId: 'item-1',
      sourceRunId: 'run-1',
      deliveryId: 'archive',
      channel: 'file',
      attemptNumber: 1,
      effectDomain: 'production',
      status: 'delivered',
      plannedAt: '2026-04-13T09:40:00.000Z',
    }),
  )
})

Deno.test('[unit] domain: delivery attempt 非终态不得携带 finishedAt', () => {
  assertThrows(() =>
    assertDeliveryAttemptInvariant({
      attemptId: 'attempt-invalid-running',
      itemId: 'item-1',
      sourceRunId: 'run-1',
      deliveryId: 'archive',
      channel: 'file',
      attemptNumber: 1,
      effectDomain: 'production',
      status: 'running',
      plannedAt: '2026-04-13T09:41:00.000Z',
      finishedAt: '2026-04-13T09:41:03.000Z',
    }),
  )
})

Deno.test('[unit] domain: failed attempt 即使伴随 skipped/filter 事实也应归类为 failed', () => {
  const run = createSourceRun({
    runId: 'run-failed-with-skips',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    scheduledAt: '2026-04-13T09:42:00.000Z',
    startedAt: '2026-04-13T09:42:01.000Z',
  })

  const failedRun = finalizeSourceRun(run, {
    fetchedCount: 3,
    parsedCount: 3,
    filteredCount: 1,
    duplicateItemCount: 1,
    deliveredCount: 0,
    failedAttemptCount: 1,
    skippedCount: 0,
    finishedAt: '2026-04-13T09:42:05.000Z',
  })

  assertEquals(failedRun.status, 'failed')
})

Deno.test('[unit] domain: 多个 delivery attempt 成功不应受 parsedCount 限制误伤', () => {
  const run = createSourceRun({
    runId: 'run-multi-delivery-success',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    scheduledAt: '2026-04-13T09:42:30.000Z',
    startedAt: '2026-04-13T09:42:31.000Z',
  })

  const successRun = finalizeSourceRun(run, {
    fetchedCount: 1,
    parsedCount: 1,
    filteredCount: 0,
    duplicateItemCount: 0,
    deliveredCount: 2,
    failedAttemptCount: 0,
    skippedCount: 0,
    finishedAt: '2026-04-13T09:42:35.000Z',
  })

  assertEquals(successRun.status, 'success')
  assertEquals(successRun.counts.deliveredCount, 2)
})

Deno.test('[unit] domain: delivery attemptNumber 必须是整数', () => {
  assertThrows(() =>
    assertDeliveryAttemptInvariant({
      attemptId: 'attempt-invalid-attempt-number',
      itemId: 'item-1',
      sourceRunId: 'run-1',
      deliveryId: 'archive',
      channel: 'file',
      attemptNumber: 1.5,
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-13T09:43:00.000Z',
    }),
  )
})

Deno.test('[unit] domain: renderedSnapshot.channel 必须与 attempt.channel 一致', () => {
  assertThrows(() =>
    assertDeliveryAttemptInvariant({
      attemptId: 'attempt-invalid-rendered-channel',
      itemId: 'item-1',
      sourceRunId: 'run-1',
      deliveryId: 'archive',
      channel: 'file',
      attemptNumber: 1,
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-13T09:44:00.000Z',
      renderedSnapshot: {
        channel: 'push',
      },
    }),
  )
})
