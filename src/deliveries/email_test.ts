import { assertEquals, assertRejects } from '@std/assert'
import { createLogger } from '../core/logger.ts'
import { createEmailDelivery } from './email.ts'

Deno.test('emailDelivery: 应把 SMTP 配置与消息转发给 transporter', async () => {
  const calls: unknown[] = []
  const delivery = createEmailDelivery({
    createTransport: (options: unknown) => ({
      sendMail: (message: unknown) => {
        calls.push({ options, message })
        return Promise.resolve({ messageId: 'msg-1' })
      },
    }),
  })

  await delivery.push({
    deliveryId: 'release_email',
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      auth: {
        username: 'user',
        password: 'pass',
      },
    },
    message: {
      from: 'bot@example.com',
      to: ['team@example.com'],
      cc: ['ops@example.com'],
      bcc: ['audit@example.com'],
      replyTo: ['reply@example.com'],
      subject: 'hello',
      text: 'world',
      html: '<p>world</p>',
      headers: {
        'X-Knock-Source': 'feed',
      },
    },
  })

  assertEquals(calls, [
    {
      options: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: 'user',
          pass: 'pass',
        },
      },
      message: {
        from: 'bot@example.com',
        to: ['team@example.com'],
        cc: ['ops@example.com'],
        bcc: ['audit@example.com'],
        replyTo: ['reply@example.com'],
        subject: 'hello',
        text: 'world',
        html: '<p>world</p>',
        headers: {
          'X-Knock-Source': 'feed',
        },
      },
    },
  ])
})

Deno.test('emailDelivery: transporter 失败时应记录失败日志并抛错', async () => {
  const logs: Array<Record<string, unknown>> = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'delivery.email',
    writeStdout: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeWarn: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeStderr: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
  })
  const delivery = createEmailDelivery({
    logger,
    createTransport: () => ({
      sendMail: () => Promise.reject(new Error('smtp failed')),
    }),
  })

  await assertRejects(
    () =>
      delivery.push({
        deliveryId: 'release_email',
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          security: 'implicit',
        },
        message: {
          from: 'bot@example.com',
          to: ['team@example.com'],
          subject: 'hello',
          text: 'world',
        },
      }),
    Error,
    'smtp failed',
  )

  assertEquals(
    logs.some((item) => {
      const scope = (item.scope ?? {}) as Record<string, unknown>
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return (
        scope.name === 'delivery.email' &&
        attributes['delivery.operation'] === 'push' &&
        attributes['delivery.outcome'] === 'failure'
      )
    }),
    true,
  )
  assertEquals(
    logs.some((item) => {
      const attributes = (item.attributes ?? {}) as Record<string, unknown>
      return String(attributes['exception.message'] ?? '').includes('smtp failed')
    }),
    true,
  )
})
