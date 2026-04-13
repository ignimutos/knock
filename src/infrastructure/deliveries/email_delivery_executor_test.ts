import { assertEquals } from '@std/assert'
import { createEmailDeliveryExecutor } from './email_delivery_executor.ts'

Deno.test('emailDeliveryExecutor: 应只消费 rendered plan 的 smtp/message', async () => {
  const calls: Array<Record<string, unknown>> = []
  const executor = createEmailDeliveryExecutor({
    delivery: {
      push: (input: unknown) => {
        calls.push(input as unknown as Record<string, unknown>)
        return Promise.resolve()
      },
    } as never,
  })

  await executor.execute({
    attemptId: 'attempt-3',
    sourceRunId: 'run-1',
    itemId: 'item-1',
    deliveryId: 'mailer',
    effectDomain: 'production',
    channel: 'email',
    plannedAt: '2026-04-13T12:02:00.000Z',
    renderedSnapshot: {
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
          cc: ['cc@example.com'],
          bcc: ['bcc@example.com'],
          replyTo: ['reply@example.com'],
          subject: 'Hello',
          text: 'Desc',
          headers: {
            'X-Source': 'rust',
          },
        },
      },
    },
  })

  assertEquals(calls, [
    {
      deliveryId: 'mailer',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      message: {
        from: 'bot@example.com',
        to: ['ops@example.com'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        replyTo: ['reply@example.com'],
        subject: 'Hello',
        text: 'Desc',
        headers: {
          'X-Source': 'rust',
        },
      },
    },
  ])
})
