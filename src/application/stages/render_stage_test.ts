import { assertEquals } from '@std/assert'
import { getAiEntryRuntime } from '../../core/ai_runtime.ts'
import { createPipelineItem } from '../../domain/pipeline_item.ts'
import { RenderStage } from './render_stage.ts'

// risk-id: R07
// layer: unit

Deno.test('[unit] renderStage: 应生成带 rendered snapshot 的 attempt plan', async () => {
  const stage = new RenderStage({
    now: () => '2026-04-13T10:10:00.000Z',
    createAttemptId: () => 'attempt-1',
    renderContent: (template, context) => {
      const entry = context.entry as { title?: string }
      const source = context.source as { id?: string; title?: string }
      return Promise.resolve(
        template
          .replace('{{ entry.title }}', entry.title ?? '')
          .replace('{{ source.id }}', source.id ?? '')
          .replace('{{ source.title }}', source.title ?? ''),
      )
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-1',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-1',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })

  const plan = await stage.run({
    item,
    binding: {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate: '{{ entry.title }}',
      },
    },
    feed: {
      title: 'Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '',
    },
  })

  assertEquals(plan.attemptId, 'attempt-1')
  assertEquals(plan.itemId, 'item-1')
  assertEquals(plan.deliveryId, 'archive')
  assertEquals(plan.channel, 'file')
  assertEquals(plan.plannedAt, '2026-04-13T10:10:00.000Z')
  assertEquals(plan.renderedSnapshot, {
    channel: 'file',
    payload: {
      path: '/tmp/archive.txt',
      content: 'Hello',
      rotation: undefined,
    },
  })
})

Deno.test('[unit] renderStage: 模板上下文应提供 canonical source 字段', async () => {
  const stage = new RenderStage({
    now: () => '2026-04-13T10:12:00.000Z',
    createAttemptId: () => 'attempt-source',
    renderContent: (template, context) => {
      const source = context.source as {
        id?: string
        title?: string
        runtime?: { window?: { scheduledAt?: string } }
      }
      return Promise.resolve(
        template
          .replace('{{ source.id }}', source.id ?? '')
          .replace('{{ source.title }}', source.title ?? '')
          .replace(
            '{{ source.runtime.window.scheduledAt }}',
            source.runtime?.window?.scheduledAt ?? '',
          ),
      )
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-source',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-source',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })

  const plan = await stage.run({
    item,
    binding: {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate:
          '{{ source.id }}|{{ source.title }}|{{ source.runtime.window.scheduledAt }}',
      },
    },
    feed: {
      title: 'Rust Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '2026-04-13T10:12:00.000Z',
    },
  })

  assertEquals(plan.renderedSnapshot.payload, {
    path: '/tmp/archive.txt',
    content: 'rust|Rust Feed|2026-04-13T10:12:00.000Z',
    rotation: undefined,
  })
})

Deno.test('[unit] renderStage: 模板上下文应保留顶层 entry 字段别名', async () => {
  const stage = new RenderStage({
    now: () => '2026-04-13T10:12:15.000Z',
    createAttemptId: () => 'attempt-entry-alias',
    renderContent: (template, context) => {
      const flat = context as { title?: string; description?: string }
      return Promise.resolve(
        template
          .replace('{{ title }}', flat.title ?? '')
          .replace('{{ description }}', flat.description ?? ''),
      )
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-entry-alias',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-alias',
      title: 'Hello',
      link: '',
      description: 'Desc',
      content: '',
      published: '',
      updated: '',
    },
  })

  const plan = await stage.run({
    item,
    binding: {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate: '{{ title }}|{{ description }}',
      },
    },
    feed: {
      title: 'Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '',
    },
  })

  assertEquals(plan.renderedSnapshot.payload, {
    path: '/tmp/archive.txt',
    content: 'Hello|Desc',
    rotation: undefined,
  })
})

Deno.test('[unit] renderStage: 模板上下文应注入 entry 级 AI runtime', async () => {
  let capturedRuntime: ReturnType<typeof getAiEntryRuntime> | undefined

  const stage = new RenderStage({
    now: () => '2026-04-13T10:12:30.000Z',
    createAttemptId: () => 'attempt-ai-runtime',
    renderContent: (_template, context) => {
      capturedRuntime = getAiEntryRuntime(context)
      return Promise.resolve('ok')
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-ai-runtime',
    sourceRunId: 'run-ai-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-ai-runtime',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })

  const plan = await stage.run({
    item,
    binding: {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate: '{{ entry.title }}',
      },
    },
    feed: {
      title: 'Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '',
    },
  })

  assertEquals(capturedRuntime, {
    sourceId: 'rust',
    entryId: 'entry-ai-runtime',
    sourceRunId: 'run-ai-1',
    cache: new Map(),
  })
  assertEquals(plan.attemptId, 'attempt-ai-runtime')
})

Deno.test('[unit] renderStage: file 应保留 rotation 配置供 executor 消费', async () => {
  const stage = new RenderStage({
    now: () => '2026-04-13T10:12:30.000Z',
    createAttemptId: () => 'attempt-rotation',
    renderContent: (template, context) => {
      const entry = context.entry as { title?: string }
      return Promise.resolve(template.replace('{{ entry.title }}', entry.title ?? ''))
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-rotation',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-rotation',
      title: 'Hello',
      link: '',
      description: '',
      content: '',
      published: '',
      updated: '',
    },
  })

  const plan = await stage.run({
    item,
    binding: {
      sourceId: 'rust',
      deliveryId: 'archive',
      definition: {
        kind: 'file',
        deliveryId: 'archive',
        path: '/tmp/archive.txt',
        contentTemplate: '{{ entry.title }}',
        rotation: {
          enabled: true,
          size: '1mb',
        },
      },
    },
    feed: {
      title: 'Feed',
      link: '',
      description: '',
      generator: '',
      language: '',
      published: '',
    },
  })

  assertEquals(plan.renderedSnapshot.payload, {
    path: '/tmp/archive.txt',
    content: 'Hello',
    rotation: {
      enabled: true,
      size: '1mb',
    },
  })
})

Deno.test('[unit] renderStage: push/email 应携带 executor 所需 transport 配置', async () => {
  const stage = new RenderStage({
    now: () => '2026-04-13T10:11:00.000Z',
    createAttemptId: () => 'attempt-2',
    renderContent: (template, context) => {
      const entry = context.entry as { title?: string; description?: string }
      return Promise.resolve(
        template
          .replace('{{ entry.title }}', entry.title ?? '')
          .replace('{{ entry.description }}', entry.description ?? ''),
      )
    },
    renderPayload: (payload) => Promise.resolve(payload),
  })

  const item = createPipelineItem({
    itemId: 'item-2',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalized: {
      id: 'entry-2',
      title: 'Hello',
      link: '',
      description: 'Desc',
      content: '',
      published: '',
      updated: '',
    },
  })
  const feed = {
    title: 'Feed',
    link: '',
    description: '',
    generator: '',
    language: '',
    published: '',
  }

  const pushPlan = await stage.run({
    item,
    feed,
    binding: {
      sourceId: 'rust',
      deliveryId: 'webhook',
      definition: {
        kind: 'push',
        deliveryId: 'webhook',
        http: {
          method: 'POST',
          url: 'https://example.com/hook',
        },
        requestType: 'body',
        payloadTemplate: { text: '{{ entry.title }}' },
        response: {
          predicate: '{{ true }}',
          message: 'ok',
        },
      },
    },
  })
  const emailPlan = await stage.run({
    item,
    feed,
    binding: {
      sourceId: 'rust',
      deliveryId: 'mailer',
      definition: {
        kind: 'email',
        deliveryId: 'mailer',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          security: 'starttls',
        },
        messageTemplate: {
          from: 'bot@example.com',
          to: ['ops@example.com'],
          subject: '{{ entry.title }}',
          text: '{{ entry.description }}',
        },
      },
    },
  })

  assertEquals(pushPlan.renderedSnapshot, {
    channel: 'push',
    payload: {
      http: {
        method: 'POST',
        url: 'https://example.com/hook',
      },
      requestType: 'body',
      payload: { text: '{{ entry.title }}' },
      response: {
        predicate: '{{ true }}',
        message: 'ok',
      },
    },
  })
  assertEquals(emailPlan.renderedSnapshot, {
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
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        subject: 'Hello',
        text: 'Desc',
        headers: undefined,
      },
    },
  })
})

Deno.test(
  '[unit] renderStage: email 应渲染 from/to/cc/bcc/replyTo/headers 等全部模板字段',
  async () => {
    const stage = new RenderStage({
      now: () => '2026-04-13T10:11:30.000Z',
      createAttemptId: () => 'attempt-email-full',
      renderContent: (template, context) => {
        const entry = context.entry as { title?: string }
        const source = context.source as { id?: string }
        return Promise.resolve(
          template
            .replace('{{ entry.title }}', entry.title ?? '')
            .replace('{{ source.id }}', source.id ?? ''),
        )
      },
      renderPayload: (payload) => Promise.resolve(payload),
    })

    const item = createPipelineItem({
      itemId: 'item-email-full',
      sourceRunId: 'run-1',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-email-full',
        title: 'Hello',
        link: '',
        description: 'Desc',
        content: '',
        published: '',
        updated: '',
      },
    })

    const plan = await stage.run({
      item,
      feed: {
        title: 'Feed',
        link: '',
        description: '',
        generator: '',
        language: '',
        published: '',
      },
      binding: {
        sourceId: 'rust',
        deliveryId: 'mailer',
        definition: {
          kind: 'email',
          deliveryId: 'mailer',
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
          },
          messageTemplate: {
            from: 'bot+{{ source.id }}@example.com',
            to: ['ops+{{ source.id }}@example.com'],
            cc: ['cc+{{ source.id }}@example.com'],
            bcc: ['bcc+{{ source.id }}@example.com'],
            replyTo: ['reply+{{ source.id }}@example.com'],
            subject: '{{ entry.title }}',
            text: 'Desc',
            headers: {
              'X-Source': '{{ source.id }}',
            },
          },
        },
      },
    })

    assertEquals(plan.renderedSnapshot, {
      channel: 'email',
      payload: {
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          security: 'starttls',
        },
        message: {
          from: 'bot+rust@example.com',
          to: ['ops+rust@example.com'],
          cc: ['cc+rust@example.com'],
          bcc: ['bcc+rust@example.com'],
          replyTo: ['reply+rust@example.com'],
          subject: 'Hello',
          text: 'Desc',
          headers: {
            'X-Source': 'rust',
          },
        },
      },
    })
  },
)
