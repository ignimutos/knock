import { assertEquals, assertRejects } from '@std/assert'
import { createEmailDeliveryExecutor } from './email_delivery_executor.ts'

// risk-id: R07
// layer: unit

Deno.test('[unit] emailDeliveryExecutor: 应只消费 rendered plan 的 smtp/message', async () => {
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

Deno.test(
  '[unit] emailDeliveryExecutor: legacy payload shape 不应再被当作 message fallback 接受',
  async () => {
    const executor = createEmailDeliveryExecutor({
      delivery: {
        push: () => Promise.resolve(),
      } as never,
    })

    await assertRejects(
      () =>
        executor.execute({
          attemptId: 'attempt-legacy',
          sourceRunId: 'run-1',
          itemId: 'item-1',
          deliveryId: 'mailer',
          effectDomain: 'production',
          channel: 'email',
          plannedAt: '2026-04-13T12:03:00.000Z',
          renderedSnapshot: {
            channel: 'email',
            payload: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                security: 'starttls',
              },
              from: 'bot@example.com',
              to: ['ops@example.com'],
              subject: 'Hello',
              text: 'Desc',
            },
          },
        }),
      Error,
      'email executor 缺少 smtp/message rendered payload',
    )
  },
)
