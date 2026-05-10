import { assertEquals } from '../../testing/assert.ts'
import type { DeliveryAttemptPlan } from '../../workflow/ports/delivery_executor.ts'
import { createCaptureDeliveryExecutor } from './capture_delivery_executor.ts'
import { test } from '../../testing/test_api.ts'

test('[contract] captureDeliveryExecutor: 应记录 attempt 而不触发外部副作用', async () => {
  const captured: DeliveryAttemptPlan[] = []
  const executor = createCaptureDeliveryExecutor({
    onCaptured: (plan) => captured.push(plan),
  })

  await executor.execute({
    attemptId: 'attempt-1',
    sourceRunId: 'run-1',
    itemId: 'item-1',
    deliveryId: 'archive',
    channel: 'file',
    effectDomain: 'preview',
    plannedAt: '2026-04-17T12:00:00.000Z',
    renderedSnapshot: {
      channel: 'file',
      payload: {
        path: '/tmp/archive.md',
        content: 'Hello',
      },
    },
  })

  assertEquals(
    captured.map((plan) => plan.deliveryId),
    ['archive'],
  )
  assertEquals(captured[0]?.effectDomain, 'preview')
})
