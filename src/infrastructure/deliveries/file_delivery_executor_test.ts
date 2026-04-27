import { assertEquals } from '@std/assert'
import { createFileDeliveryExecutor } from './file_delivery_executor.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R09
// layer: unit

test('[unit] fileDeliveryExecutor: 应只消费 rendered plan 并透传 rotation', async () => {
  const calls: Array<Record<string, unknown>> = []
  const executor = createFileDeliveryExecutor({
    runtimeDir: '/tmp',
    delivery: {
      push: (input: unknown) => {
        calls.push(input as unknown as Record<string, unknown>)
        return Promise.resolve()
      },
    } as never,
  })

  await executor.execute({
    attemptId: 'attempt-1',
    sourceRunId: 'run-1',
    itemId: 'item-1',
    deliveryId: 'archive',
    effectDomain: 'production',
    channel: 'file',
    plannedAt: '2026-04-13T12:00:00.000Z',
    renderedSnapshot: {
      channel: 'file',
      payload: {
        path: '/tmp/archive.txt',
        content: 'hello',
        rotation: {
          enabled: true,
          size: '1mb',
        },
      },
    },
  })

  assertEquals(calls, [
    {
      path: '/tmp/archive.txt',
      content: 'hello',
      rotation: {
        enabled: true,
        size: '1mb',
      },
    },
  ])
})
