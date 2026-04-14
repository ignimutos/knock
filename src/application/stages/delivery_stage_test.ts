import { assertEquals } from '@std/assert'
import type { DeliveryAttemptPlan } from '../ports/delivery_executor.ts'
import { DeliveryStage } from './delivery_stage.ts'

// risk-id: R07
// layer: unit

function createPlan(): DeliveryAttemptPlan {
  return {
    attemptId: 'attempt-1',
    sourceRunId: 'run-1',
    itemId: 'item-1',
    deliveryId: 'telegram',
    effectDomain: 'production',
    channel: 'push',
    plannedAt: '2026-04-13T10:20:00.000Z',
    renderedSnapshot: {
      channel: 'push',
      payload: {
        text: 'hello',
      },
    },
  }
}

Deno.test('[unit] deliveryStage: 成功结果应生成 attempt 终态时间', async () => {
  const seenPlans: DeliveryAttemptPlan[] = []
  const stage = new DeliveryStage({
    now: (() => {
      const values = ['2026-04-13T10:20:01.000Z', '2026-04-13T10:20:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:20:02.000Z'
    })(),
    executor: {
      execute: (plan) => {
        seenPlans.push(plan)
        return Promise.resolve()
      },
    },
  })

  const result = await stage.run(createPlan())

  assertEquals(seenPlans.length, 1)
  assertEquals(result.status, 'delivered')
  assertEquals(result.startedAt, '2026-04-13T10:20:01.000Z')
  assertEquals(result.finishedAt, '2026-04-13T10:20:02.000Z')
})

Deno.test('[unit] deliveryStage: 失败细节应主归属 attempt', async () => {
  const stage = new DeliveryStage({
    now: (() => {
      const values = ['2026-04-13T10:21:01.000Z', '2026-04-13T10:21:02.000Z']
      return () => values.shift() ?? '2026-04-13T10:21:02.000Z'
    })(),
    executor: {
      execute: () => Promise.reject(new Error('telegram 500')),
    },
  })

  const result = await stage.run(createPlan())

  assertEquals(result.status, 'failed')
  assertEquals(result.reason, 'telegram 500')
  assertEquals(result.startedAt, '2026-04-13T10:21:01.000Z')
  assertEquals(result.finishedAt, '2026-04-13T10:21:02.000Z')
})
