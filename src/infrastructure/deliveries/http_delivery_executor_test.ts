import { assertEquals } from '@std/assert'
import { createHttpDeliveryExecutor } from './http_delivery_executor.ts'

// risk-id: R07
// layer: unit

Deno.test(
  '[unit] httpDeliveryExecutor: 应只消费 rendered plan 的 http/request/response',
  async () => {
    const calls: Array<Record<string, unknown>> = []
    const executor = createHttpDeliveryExecutor({
      httpClient: {} as never,
      delivery: {
        push: (input: unknown) => {
          calls.push(input as unknown as Record<string, unknown>)
          return Promise.resolve()
        },
      } as never,
    })

    await executor.execute({
      attemptId: 'attempt-2',
      sourceRunId: 'run-1',
      itemId: 'item-1',
      deliveryId: 'webhook',
      effectDomain: 'production',
      channel: 'push',
      plannedAt: '2026-04-13T12:01:00.000Z',
      renderedSnapshot: {
        channel: 'push',
        payload: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
          },
          requestType: 'body',
          payload: { text: 'hello' },
          response: {
            predicate: '{{ true }}',
            message: 'ok',
          },
        },
      },
    })

    assertEquals(calls, [
      {
        deliveryId: 'webhook',
        http: {
          method: 'POST',
          url: 'https://example.com/hook',
        },
        request: {
          type: 'body',
          payload: { text: 'hello' },
        },
        response: {
          predicate: '{{ true }}',
          message: 'ok',
        },
      },
    ])
  },
)
