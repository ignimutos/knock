import { assertEquals, assertRejects } from '@std/assert'
import { attachAiEntryRuntime, createAiRuntime } from '../core/ai_runtime.ts'
import { createContentRuntime } from '../core/content_runtime.ts'
import { attachLogFields, createLogger } from '../core/logger.ts'
import { createDeliveryRuntime } from './delivery_runtime.ts'

function createTestLogger(records: Array<Record<string, unknown>>) {
  const write = (line: string) => {
    records.push(JSON.parse(line) as Record<string, unknown>)
  }

  return createLogger({
    enabled: true,
    level: 'info',
    module: 'test',
    now: () => new Date('2026-04-11T08:00:00.000Z'),
    writeStdout: write,
    writeWarn: write,
    writeStderr: write,
  })
}

Deno.test('deliveryRuntime: file 投递应选择并渲染 file content 模板后分发', async () => {
  const renderedTemplates: Array<{ template: string; context: Record<string, unknown> }> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template, context) => {
        renderedTemplates.push({ template, context })
        return Promise.resolve(`rendered:${template}`)
      },
      renderPayload: (payload) => Promise.resolve(payload),
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
      templateContext,
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
      renderPayload: (payload, context) => {
        void payload
        return Promise.resolve({
          text: String((context.entry as { title?: string }).title ?? ''),
          nested: {
            source: String((context.source as { id?: string }).id ?? ''),
          },
        })
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
      templateContext,
    },
  ])
})

Deno.test('deliveryRuntime: HTTP payload 中可使用 ai_summarize', async () => {
  const aiCalls: Array<Record<string, unknown>> = []
  const calls: unknown[] = []
  const aiRuntime = createAiRuntime({
    ai: {
      providers: [
        {
          id: 'openai_main',
          type: 'openai',
          apiKey: 'test-key',
          models: [
            {
              id: 'default',
              providerId: 'openai_main',
              providerType: 'openai',
              ref: 'openai_main/default',
              model: 'gpt-4o-mini',
              context: 8192,
              maxOutputTokens: 400,
              variants: {},
            },
          ],
        },
      ],
      defaultModel: {
        ref: 'openai_main/default',
        providerId: 'openai_main',
        modelId: 'default',
      },
      modelRefs: {
        'openai_main/default': {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
      },
    },
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      aiCalls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: 'AI 摘要' })
    },
  })
  const runtime = createDeliveryRuntime({
    contentRuntime: createContentRuntime({ aiRuntime }),
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: {
      push: (req) => {
        calls.push(req)
        return Promise.resolve()
      },
    },
    emailDelivery: { push: () => Promise.resolve() },
  })

  const templateContext = attachAiEntryRuntime(
    {
      entry: { description: '需要摘要的正文' },
    },
    aiRuntime.createEntryRuntime('source-a', 'entry-a'),
  )

  await runtime.push(
    {
      id: 'webhook',
      push: {
        http: {
          method: 'POST',
          url: 'https://example.com/webhook',
        },
        request: {
          type: 'body',
          payload: {
            summary: '{{ entry.description | ai_summarize }}',
          },
        },
      },
    },
    templateContext,
  )

  assertEquals(aiCalls.length, 1)
  assertEquals(calls, [
    {
      deliveryId: 'webhook',
      http: {
        method: 'POST',
        url: 'https://example.com/webhook',
        timeout: undefined,
        headers: undefined,
        proxy: undefined,
      },
      request: {
        type: 'body',
        payload: {
          summary: 'AI 摘要',
        },
      },
      response: undefined,
      templateContext,
    },
  ])
})

Deno.test('deliveryRuntime: HTTP response 模板应保留原模板并透传 templateContext', async () => {
  const renderedTemplates: Array<{ template: string; context: Record<string, unknown> }> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    contentRuntime: {
      renderContent: (template, context) => {
        renderedTemplates.push({ template, context })
        return Promise.resolve(`rendered:${template}`)
      },
      renderPayload: (payload) => Promise.resolve(payload),
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
    entry: { description: '需要摘要的正文' },
  }

  await runtime.push(
    {
      id: 'webhook',
      push: {
        http: {
          method: 'POST',
          url: 'https://example.com/webhook',
        },
        request: {
          type: 'body',
        },
        response: {
          predicate: '{{ ok }}',
          message: '{{ entry.description | ai_summarize }}',
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
        headers: undefined,
        proxy: undefined,
      },
      request: {
        type: 'body',
        payload: undefined,
      },
      response: {
        predicate: '{{ ok }}',
        message: '{{ entry.description | ai_summarize }}',
      },
      templateContext,
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
      renderPayload: (payload) => Promise.resolve(payload),
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
      templateContext,
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
      renderPayload: (payload) => Promise.resolve(payload),
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
      renderPayload: (payload) => Promise.resolve(payload),
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
      renderPayload: (payload) => Promise.resolve(payload),
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

Deno.test('deliveryRuntime: 应记录 build/render/dispatch 阶段日志并透传上下文字段', async () => {
  const logs: Array<Record<string, unknown>> = []
  const calls: unknown[] = []
  const runtime = createDeliveryRuntime({
    logger: createTestLogger(logs),
    contentRuntime: {
      renderContent: () => Promise.resolve('unused'),
      renderPayload: (_payload: unknown, context: Record<string, unknown>) =>
        Promise.resolve({
          text: String((context.entry as { title?: string }).title ?? ''),
        }),
    },
    fileDelivery: { push: () => Promise.resolve() },
    httpDelivery: {
      push: (req: unknown) => {
        calls.push(req)
        return Promise.resolve()
      },
    },
    emailDelivery: { push: () => Promise.resolve() },
  } as never)

  const templateContext = attachLogFields(
    {
      entry: { title: 'Hello HTTP', body: 'secret body' },
      source: { id: 'source-1' },
      delivery: { ignored: true },
    },
    {
      'source.id': 'source-1',
    },
  )

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
          },
        },
      },
    },
    templateContext,
  )

  assertEquals(calls.length, 1)
  assertEquals(logs.length, 3)

  const buildLog = logs.find((line) => line.body === 'delivery 请求构建完成')
  const renderLog = logs.find((line) => line.body === 'delivery payload 渲染完成')
  const dispatchLog = logs.find((line) => line.body === 'delivery 已分发')
  const buildAttributes = (buildLog?.attributes ?? {}) as Record<string, unknown>
  const renderAttributes = (renderLog?.attributes ?? {}) as Record<string, unknown>
  const dispatchAttributes = (dispatchLog?.attributes ?? {}) as Record<string, unknown>

  assertEquals((buildLog?.scope as Record<string, unknown>).name, 'delivery.runtime.build')
  assertEquals(buildAttributes['delivery.operation'], 'build_request')
  assertEquals(buildAttributes['delivery.outcome'], 'success')
  assertEquals(buildAttributes['delivery.id'], 'webhook')
  assertEquals(buildAttributes['source.id'], 'source-1')
  assertEquals('body' in buildAttributes, false)
  assertEquals(JSON.stringify(buildLog).includes('secret body'), false)

  assertEquals((renderLog?.scope as Record<string, unknown>).name, 'delivery.runtime.render')
  assertEquals(renderAttributes['delivery.operation'], 'render_payload')
  assertEquals(renderAttributes['delivery.outcome'], 'success')
  assertEquals(renderAttributes['delivery.id'], 'webhook')
  assertEquals(renderAttributes['source.id'], 'source-1')
  assertEquals(renderAttributes['delivery.request_type'], 'body')
  assertEquals(JSON.stringify(renderLog).includes('secret body'), false)

  assertEquals((dispatchLog?.scope as Record<string, unknown>).name, 'delivery.runtime.dispatch')
  assertEquals(dispatchAttributes['delivery.operation'], 'dispatch')
  assertEquals(dispatchAttributes['delivery.outcome'], 'success')
  assertEquals(dispatchAttributes['delivery.id'], 'webhook')
  assertEquals(dispatchAttributes['source.id'], 'source-1')
  assertEquals(JSON.stringify(dispatchLog).includes('secret body'), false)
})

Deno.test(
  'deliveryRuntime: file 与 email 分支也应记录 build/render/dispatch 且透传 run_id',
  async () => {
    const logs: Array<Record<string, unknown>> = []
    const fileCalls: unknown[] = []
    const emailCalls: unknown[] = []
    const runtime = createDeliveryRuntime({
      logger: createTestLogger(logs),
      contentRuntime: {
        renderContent: (template: string, context: Record<string, unknown>) =>
          Promise.resolve(
            `rendered:${template}:${String((context.entry as { id?: string }).id ?? '')}`,
          ),
        renderPayload: (payload: unknown) => Promise.resolve(payload),
      },
      fileDelivery: {
        push: (req: unknown) => {
          fileCalls.push(req)
          return Promise.resolve()
        },
      },
      httpDelivery: { push: () => Promise.resolve() },
      emailDelivery: {
        push: (req: unknown) => {
          emailCalls.push(req)
          return Promise.resolve()
        },
      },
    } as never)

    const templateContext = attachLogFields(
      {
        entry: { id: 'entry-1', title: 'Hello', body: 'secret body' },
        source: { id: 'source-1' },
      },
      {
        'source.id': 'source-1',
        'source.run_id': 'run-1',
        'pipeline.item_id': 'entry-1',
      },
    )

    await runtime.push(
      {
        id: 'archive',
        file: {
          path: '/tmp/feed.md',
          content: '{{ entry.title }}',
        },
      },
      templateContext,
    )

    await runtime.push(
      {
        id: 'release_email',
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: '{{ entry.title }}',
            text: '{{ entry.title }}',
          },
        },
      },
      templateContext,
    )

    assertEquals(fileCalls.length, 1)
    assertEquals(emailCalls.length, 1)

    const renderLogs = logs.filter(
      (line) => line.body === 'delivery 内容渲染完成' || line.body === 'delivery 消息渲染完成',
    )
    const buildLogs = logs.filter((line) => line.body === 'delivery 请求构建完成')
    const dispatchLogs = logs.filter((line) => line.body === 'delivery 已分发')

    assertEquals(renderLogs.length, 2)
    assertEquals(buildLogs.length >= 2, true)
    assertEquals(dispatchLogs.length >= 2, true)

    for (const line of [...renderLogs, ...buildLogs, ...dispatchLogs]) {
      const attributes = (line.attributes ?? {}) as Record<string, unknown>
      assertEquals(attributes['source.id'], 'source-1')
      assertEquals(attributes['source.run_id'], 'run-1')
      assertEquals(attributes['pipeline.item_id'], 'entry-1')
      assertEquals(JSON.stringify(line).includes('secret body'), false)
    }
  },
)
