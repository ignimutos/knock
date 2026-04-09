import { assertEquals, assertRejects } from '@std/assert'
import { createDeliveryRuntime } from './delivery_runtime.ts'

Deno.test('deliveryRuntime: file 投递应选择并渲染 file content 模板后分发', async () => {
  const renderedTemplates: Array<{ template: string; context: Record<string, unknown> }> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template, context) => {
        renderedTemplates.push({ template, context })
        return Promise.resolve(`rendered:${template}`)
      },
    },
    fileDelivery: {
      push: (req) => {
        calls.push(req)
        return Promise.resolve()
      },
    },
    httpDelivery: { push: () => Promise.resolve() },
    emailDelivery: { push: () => Promise.resolve() },
  })

  const templateContext = { entry: { title: 'Hello File' } }
  await runtime.push(
    {
      id: 'archive',
      file: {
        path: '/tmp/feed.md',
        content: '{{ entry.title }}',
        rotation: {
          enabled: true,
          size: '10m',
        },
      },
    },
    templateContext,
  )

  assertEquals(renderedTemplates, [
    {
      template: '{{ entry.title }}',
      context: templateContext,
    },
  ])
  assertEquals(calls, [
    {
      path: '/tmp/feed.md',
      content: 'rendered:{{ entry.title }}',
      rotation: {
        enabled: true,
        size: '10m',
      },
    },
  ])
})

Deno.test('deliveryRuntime: HTTP 投递应只递归渲染 payload 而不额外渲染 content', async () => {
  const renderedTemplates: Array<{ template: string; context: Record<string, unknown> }> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template, context) => {
        renderedTemplates.push({ template, context })
        return Promise.resolve(`rendered:${template}`)
      },
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: {
      push: (req) => {
        calls.push(req)
        return Promise.resolve()
      },
    },
    emailDelivery: { push: () => Promise.resolve() },
  })

  const templateContext = {
    entry: { title: 'Hello HTTP' },
    source: { id: 'source-1' },
  }
  await runtime.push(
    {
      id: 'webhook',
      push: {
        http: {
          method: 'POST',
          url: 'https://example.com/webhook',
          headers: { Authorization: 'Bearer token' },
        },
        request: {
          type: 'body',
          payload: {
            text: '{{ entry.title }}',
            nested: {
              source: '{{ source.id }}',
            },
          },
        },
        response: {
          predicate: '{{ ok }}',
        },
      },
    },
    templateContext,
  )

  assertEquals(renderedTemplates, [])
  assertEquals(calls, [
    {
      deliveryId: 'webhook',
      http: {
        method: 'POST',
        url: 'https://example.com/webhook',
        timeout: undefined,
        headers: { Authorization: 'Bearer token' },
        proxy: undefined,
      },
      request: {
        type: 'body',
        payload: {
          text: 'Hello HTTP',
          nested: {
            source: 'source-1',
          },
        },
      },
      response: {
        predicate: '{{ ok }}',
      },
    },
  ])
})

Deno.test('deliveryRuntime: email 投递应渲染 message 字段并分发到 emailDelivery', async () => {
  const renderedTemplates: Array<{ template: string; context: Record<string, unknown> }> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template, context) => {
        renderedTemplates.push({ template, context })
        const replacements: Record<string, string> = {
          '{{ source.id }}@example.com': 'feed@example.com',
          'team+{{ entry.id }}@example.com': 'team+entry-1@example.com',
          'ops@example.com': 'ops@example.com',
          'audit@example.com': 'audit@example.com',
          'reply@example.com': 'reply@example.com',
          '[{{ source.id }}] {{ entry.title }}': '[feed] Hello Email',
          '{{ entry.title }}': 'Hello Email',
          '<p>{{ entry.title }}</p>': '<p>Hello Email</p>',
          '{{ source.id }}': 'feed',
        }
        return Promise.resolve(replacements[template] ?? template)
      },
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: { push: () => Promise.resolve() },
    emailDelivery: {
      push: (req: unknown) => {
        calls.push(req)
        return Promise.resolve()
      },
    },
  })

  const templateContext = {
    entry: { id: 'entry-1', title: 'Hello Email' },
    source: { id: 'feed' },
  }

  await runtime.push(
    {
      id: 'release_email',
      email: {
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
          from: '{{ source.id }}@example.com',
          to: ['team+{{ entry.id }}@example.com'],
          cc: ['ops@example.com'],
          bcc: ['audit@example.com'],
          replyTo: ['reply@example.com'],
          subject: '[{{ source.id }}] {{ entry.title }}',
          text: '{{ entry.title }}',
          html: '<p>{{ entry.title }}</p>',
          headers: {
            'X-Knock-Source': '{{ source.id }}',
          },
        },
      },
    },
    templateContext,
  )

  assertEquals(renderedTemplates, [
    { template: '{{ source.id }}@example.com', context: templateContext },
    { template: '[{{ source.id }}] {{ entry.title }}', context: templateContext },
    { template: 'team+{{ entry.id }}@example.com', context: templateContext },
    { template: 'ops@example.com', context: templateContext },
    { template: 'audit@example.com', context: templateContext },
    { template: 'reply@example.com', context: templateContext },
    { template: '{{ entry.title }}', context: templateContext },
    { template: '<p>{{ entry.title }}</p>', context: templateContext },
    { template: '{{ source.id }}', context: templateContext },
  ])
  assertEquals(calls, [
    {
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
        from: 'feed@example.com',
        to: ['team+entry-1@example.com'],
        cc: ['ops@example.com'],
        bcc: ['audit@example.com'],
        replyTo: ['reply@example.com'],
        subject: '[feed] Hello Email',
        text: 'Hello Email',
        html: '<p>Hello Email</p>',
        headers: {
          'X-Knock-Source': 'feed',
        },
      },
    },
  ])
})

Deno.test('deliveryRuntime: email 地址渲染后非法时应在发送前失败', async () => {
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template) =>
        Promise.resolve(template === '{{ bad }}' ? 'not-an-email' : template),
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: { push: () => Promise.resolve() },
    emailDelivery: { push: () => Promise.resolve() },
  })

  await assertRejects(
    () =>
      runtime.push(
        {
          id: 'release_email',
          email: {
            smtp: {
              host: 'smtp.example.com',
              port: 587,
              security: 'starttls',
            },
            message: {
              from: '{{ bad }}',
              to: ['team@example.com'],
              subject: 'hello',
              text: 'world',
            },
          },
        },
        {},
      ),
    Error,
    'deliveries.*.email.message.from 渲染结果不是合法邮箱地址',
  )
})

Deno.test('deliveryRuntime: delivery 标识应直接使用 delivery.id', () => {
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: () => Promise.resolve('ignored'),
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: { push: () => Promise.resolve() },
    emailDelivery: { push: () => Promise.resolve() },
  })

  const httpDelivery = {
    id: 'webhook',
    push: {
      http: {
        method: 'POST' as const,
        url: 'https://example.com/webhook',
      },
      request: {
        type: 'query' as const,
      },
    },
  }

  assertEquals(runtime.getDeliveryId(httpDelivery), 'webhook')
})

Deno.test('deliveryRuntime: 未配置目标时应报错', async () => {
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: () => Promise.resolve('ignored'),
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: { push: () => Promise.resolve() },
    emailDelivery: { push: () => Promise.resolve() },
  })

  await assertRejects(
    () => runtime.push({ id: 'broken' } as never, {}),
    Error,
    'delivery 未配置投递目标: broken',
  )
})
