import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { getAiEntryRuntime } from './ai_runtime.ts'
import {
  createContentRuntime,
  buildContext,
  renderContent,
  renderPayload,
  shouldPassFilter,
} from './content_runtime.ts'
import { createLogger } from './logger.ts'

Deno.test('contentRuntime: buildContext 应默认将 entry 拍平到模板顶层并保留命名空间', () => {
  const aiEntryRuntime = { sourceId: 's1', entryId: 'id-1', cache: new Map() }
  const context = buildContext(
    { id: 'id-1', title: 'Hello', link: 'https://example.com/entry' },
    { title: 'Feed', link: 'https://example.com/feed' },
    {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/feed.xml',
      },
      syndication: {},
    } as never,
    aiEntryRuntime,
  )

  assertEquals(context, {
    id: 'id-1',
    title: 'Hello',
    link: 'https://example.com/entry',
    entry: { id: 'id-1', title: 'Hello', link: 'https://example.com/entry' },
    feed: { title: 'Feed', link: 'https://example.com/feed' },
    source: {
      id: 's1',
      enabled: true,
      deliveries: [],
      http: {
        url: 'https://example.com/feed.xml',
      },
      syndication: {},
    },
  })
  assertEquals(getAiEntryRuntime(context), aiEntryRuntime)
})

Deno.test('contentRuntime: shouldPassFilter 支持顶层 entry 字段', async () => {
  const passed = await shouldPassFilter('{{ title == "Rust" }}', {
    title: 'Rust',
    entry: { title: 'Rust' },
    feed: { title: 'Feed' },
  })

  assertEquals(passed, true)
})

Deno.test('contentRuntime: shouldPassFilter 顶层 entry 字段返回 false 时拦截', async () => {
  const passed = await shouldPassFilter('{{ title == "Rust" }}', {
    title: 'Go',
    entry: { title: 'Go' },
    feed: { title: 'Feed' },
  })

  assertEquals(passed, false)
})

Deno.test('contentRuntime: shouldPassFilter 顶层 entry 字段支持 match_fuzzy', async () => {
  const passed = await shouldPassFilter("{{ title | match_fuzzy: 'zzz' }}", {
    title: 'Example',
    entry: { title: 'Example' },
  })

  assertEquals(passed, false)
})

Deno.test('contentRuntime: shouldPassFilter 顶层 entry 字段支持 match_regex', async () => {
  const passed = await shouldPassFilter("{{ title | match_regex: '^Ex' }}", {
    title: 'Example',
    entry: { title: 'Example' },
  })

  assertEquals(passed, true)
})

Deno.test('contentRuntime: shouldPassFilter 支持反转 match_regex', async () => {
  const passed = await shouldPassFilter("{{ title | match_regex: '^Ex', true }}", {
    title: 'Example',
    entry: { title: 'Example' },
  })

  assertEquals(passed, false)
})

Deno.test('contentRuntime: shouldPassFilter 顶层 entry 字段非法 regex 会透传错误', async () => {
  await assertRejects(
    () =>
      shouldPassFilter("{{ title | match_regex: '[' }}", {
        title: 'Example',
        entry: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('contentRuntime: shouldPassFilter 仍支持 entry 命名空间写法', async () => {
  const passed = await shouldPassFilter('{{ entry.title == "Rust" }}', {
    entry: { title: 'Rust' },
  })

  assertEquals(passed, true)
})

Deno.test('contentRuntime: shouldPassFilter 渲染失败应报错并中止', async () => {
  await assertRejects(() => shouldPassFilter('{{', { entry: { title: 'Rust' } }), Error)
})

Deno.test('contentRuntime: renderContent 应支持顶层 entry 字段渲染字符串模板', async () => {
  const out = await renderContent('{{ title }} - {{ link }}', {
    title: 'Rust',
    link: 'https://example.com',
    entry: { title: 'Rust', link: 'https://example.com' },
  })

  assertEquals(out, 'Rust - https://example.com')
})

Deno.test('contentRuntime: renderContent 仍支持 entry 命名空间', async () => {
  const out = await renderContent('{{ entry.title }} - {{ entry.link }}', {
    entry: { title: 'Rust', link: 'https://example.com' },
  })

  assertEquals(out, 'Rust - https://example.com')
})

Deno.test(
  'contentRuntime: renderContent 顶层 entry 字段应继续支持共享 runtime filter',
  async () => {
    const out = await renderContent("{{ title | match_exact: 'Rust' }}", {
      title: 'Rust',
      entry: { title: 'Rust' },
    })

    assertEquals(out, 'true')
  },
)

Deno.test('contentRuntime: renderContent 纯文本 content 应按字面量渲染', async () => {
  const out = await renderContent('hello', { entry: { title: 'Hello' } })
  assertEquals(out, 'hello')
})

Deno.test('contentRuntime: renderContent 应拒绝非法模板内容类型', async () => {
  await assertRejects(
    () =>
      renderContent({ content: '{{ entry.title }}' } as never, {
        entry: { title: 'Hello' },
      }),
    Error,
    '模板内容非法',
  )
})

Deno.test('contentRuntime: renderPayload 应递归渲染 HTTP payload 中的 Liquid 字符串', async () => {
  const payload = await renderPayload(
    {
      text: '{{ entry.title }} => {{ entry.link }}',
      source: '{{ source.id }}',
      items: ['{{ feed.title }}', '{{ entry.published }}'],
      nested: {
        ok: '{{ entry.title | match_exact: "hello" }}',
      },
      enabled: true,
      nullable: null,
    },
    {
      title: 'hello',
      link: 'https://example.com/item',
      published: '2026-04-05 22:00:00',
      entry: {
        title: 'hello',
        link: 'https://example.com/item',
        published: '2026-04-05 22:00:00',
      },
      feed: {
        title: 'Feed Title',
      },
      source: {
        id: 's1',
      },
    },
  )

  assertEquals(payload, {
    text: 'hello => https://example.com/item',
    source: 's1',
    items: ['Feed Title', '2026-04-05 22:00:00'],
    nested: {
      ok: 'true',
    },
    enabled: true,
    nullable: null,
  })
})

Deno.test('contentRuntime: 业务 runtime 在 to_telegram_html 正常路径输出 debug 日志', async () => {
  const logs: Array<Record<string, unknown>> = []
  const logger = createLogger({
    enabled: true,
    level: 'debug',
    module: 'app.startup',
    now: () => new Date('2026-04-10T08:00:00.000Z'),
    writeStdout: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeWarn: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeStderr: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
  })
  const runtime = createContentRuntime({
    logger: logger.child({ module: 'content.render' }),
  } as never)

  const out = await runtime.renderContent('{{ entry.content | to_telegram_html }}', {
    entry: {
      content: '<blockquote expandable>Quote</blockquote><a href="https://example.com">Link</a>',
    },
  })

  assertEquals(
    out,
    '<blockquote expandable>Quote</blockquote><a href="https://example.com">Link</a>',
  )
  assertEquals(logs.length, 1)
  assertEquals(logs[0].severityText, 'DEBUG')
  assertEquals((logs[0].scope as Record<string, unknown>).name, 'content.render')
  assertStringIncludes(String(logs[0].body ?? ''), 'Telegram HTML')
  assertEquals(
    (logs[0].attributes as Record<string, unknown>)['template.filter_name'],
    'to_telegram_html',
  )
  assertEquals(
    (logs[0].attributes as Record<string, unknown>)['template.operation'],
    'sanitize_telegram_html',
  )
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.reason'], 'unchanged')
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.changed'], false)
  assertEquals('operation' in (logs[0].attributes as Record<string, unknown>), false)
})

Deno.test('contentRuntime: 业务 runtime 在 to_telegram_html 自动修正时输出 info 日志', async () => {
  const logs: Array<Record<string, unknown>> = []
  const logger = createLogger({
    enabled: true,
    level: 'debug',
    module: 'app.startup',
    now: () => new Date('2026-04-10T08:00:00.000Z'),
    writeStdout: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeWarn: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    writeStderr: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
  })
  const runtime = createContentRuntime({
    logger: logger.child({ module: 'content.render' }),
  } as never)

  const out = await runtime.renderContent('{{ entry.content | to_telegram_html }}', {
    entry: {
      content: '<a href="/docs/releases" rel="nofollow">Releases</a><foo bar="baz">ignored</foo>',
    },
  })

  assertEquals(out, 'Releasesignored')
  assertEquals(logs.length, 1)
  assertEquals(logs[0].severityText, 'INFO')
  assertEquals((logs[0].scope as Record<string, unknown>).name, 'content.render')
  assertEquals(
    (logs[0].attributes as Record<string, unknown>)['template.filter_name'],
    'to_telegram_html',
  )
  assertEquals(
    (logs[0].attributes as Record<string, unknown>)['template.operation'],
    'sanitize_telegram_html',
  )
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.reason'], 'auto_corrected')
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.changed'], true)
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.removed_link_count'], 1)
  assertEquals((logs[0].attributes as Record<string, unknown>)['template.stripped_tag_count'], 1)
  assertEquals('operation' in (logs[0].attributes as Record<string, unknown>), false)
})

Deno.test(
  'contentRuntime: 业务 runtime 在 multiline 相对链接自动修正时仍只输出一条 info 日志',
  async () => {
    const logs: Array<Record<string, unknown>> = []
    const logger = createLogger({
      enabled: true,
      level: 'debug',
      module: 'app.startup',
      now: () => new Date('2026-04-10T08:00:00.000Z'),
      writeStdout: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
      writeWarn: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
      writeStderr: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
    })
    const runtime = createContentRuntime({
      logger: logger.child({ module: 'content.render' }),
    } as never)

    const out = await runtime.renderContent('{{ entry.content | to_telegram_html }}', {
      entry: {
        content: '<a href="/docs/releases">Release\nnotes</a>',
      },
    })

    assertEquals(out, 'Release\nnotes')
    assertEquals(logs.length, 1)
    assertEquals(logs[0].severityText, 'INFO')
    assertEquals((logs[0].scope as Record<string, unknown>).name, 'content.render')
    assertEquals(
      (logs[0].attributes as Record<string, unknown>)['template.filter_name'],
      'to_telegram_html',
    )
    assertEquals(
      (logs[0].attributes as Record<string, unknown>)['template.operation'],
      'sanitize_telegram_html',
    )
    assertEquals(
      (logs[0].attributes as Record<string, unknown>)['template.reason'],
      'auto_corrected',
    )
    assertEquals((logs[0].attributes as Record<string, unknown>)['template.changed'], true)
    assertEquals((logs[0].attributes as Record<string, unknown>)['template.removed_link_count'], 1)
    assertEquals('operation' in (logs[0].attributes as Record<string, unknown>), false)
  },
)

Deno.test('contentRuntime: shared runtime 的 to_telegram_html 不产生日志', async () => {
  const out = await renderContent('{{ entry.content | to_telegram_html }}', {
    entry: {
      content: '<a href="/docs/releases">Releases</a>',
    },
  })

  assertEquals(out, 'Releases')
})
