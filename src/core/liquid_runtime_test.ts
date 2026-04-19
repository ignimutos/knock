import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { attachAiEntryRuntime, createAiRuntime } from './ai_runtime.ts'
import { createLiquidRuntime, renderLiquid, renderLiquidSync } from './liquid_runtime.ts'
import { createLogger } from './logger.ts'

Deno.test('[contract] liquidRuntime: async 渲染可用', async () => {
  const out = await renderLiquid('{{ item.title }}', {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'Rust')
})

Deno.test('[contract] liquidRuntime: sync 渲染可用', () => {
  const out = renderLiquidSync('{{ item.title }}', { item: { title: 'Rust' } })
  assertEquals(out, 'Rust')
})

Deno.test('[contract] liquidRuntime: match_exact 可用于 async 渲染', async () => {
  const out = await renderLiquid("{{ item.title | match_exact: 'Rust' }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_exact 支持反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_exact: 'Rust', true }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'false')
})

Deno.test('[contract] liquidRuntime: match_exact 不匹配时反转后返回 true', () => {
  const out = renderLiquidSync("{{ item.title | match_exact: 'Go', true }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_exact 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_exact: 'Rust', 'true' }}", {
        item: { title: 'Rust' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: match_fuzzy 默认 both', async () => {
  const out = await renderLiquid("{{ item.title | match_fuzzy: 'amp' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 支持 left', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 支持 right', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'ple', 'right' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 支持默认模式的反转短写', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'amp', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 支持显式 mode 与反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 不匹配时反转后返回 true', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'zzz', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_fuzzy 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left', 'true' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: match_regex 支持 flags', async () => {
  const out = await renderLiquid("{{ item.title | match_regex: '^example$', 'i' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: match_regex 支持无 flags 的反转短写', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^Ex', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('[contract] liquidRuntime: match_regex 支持 flags 与反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^example$', 'i', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('[contract] liquidRuntime: match_regex 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_regex: '^Ex', 'i', 'true' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: 非法 mode 会报错', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'middle' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: 非法 regex 会报错', async () => {
  await assertRejects(
    () =>
      renderLiquid("{{ item.title | match_regex: '[' }}", {
        item: { title: 'Rust' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: sync 路径支持 match_regex', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^example$', 'i' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('[contract] liquidRuntime: extract_regex 默认返回第一个捕获组', () => {
  const out = renderLiquidSync("{{ item.title | extract_regex: '([0-9]+)(?=元)' }}", {
    item: { title: '价格 1999元' },
  })
  assertEquals(out, '1999')
})

Deno.test('[contract] liquidRuntime: extract_regex 无捕获组时返回整个 match', () => {
  const out = renderLiquidSync("{{ item.title | extract_regex: '[0-9]+(?=元)' }}", {
    item: { title: '价格 1999元' },
  })
  assertEquals(out, '1999')
})

Deno.test('[contract] liquidRuntime: extract_regex 支持 flags 与显式 group', () => {
  const out = renderLiquidSync("{{ item.title | extract_regex: '(release) +([0-9]+)', 'i', 2 }}", {
    item: { title: 'Release 42' },
  })
  assertEquals(out, '42')
})

Deno.test('[contract] liquidRuntime: extract_regex 未匹配时返回空串', () => {
  const out = renderLiquidSync("{{ item.title | extract_regex: '([0-9]+)(?=元)' }}", {
    item: { title: '价格待定' },
  })
  assertEquals(out, '')
})

Deno.test('[contract] liquidRuntime: extract_regex group 越界时抛错', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | extract_regex: '([0-9]+)(?=元)', 2 }}", {
        item: { title: '价格 1999元' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: extract_regex 非法 regex 会报错', async () => {
  await assertRejects(
    () =>
      renderLiquid("{{ item.title | extract_regex: '[' }}", {
        item: { title: 'Rust' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: strip_html 可用于 async 渲染', async () => {
  const out = await renderLiquid('{{ item.content | strip_html }}', {
    item: { content: '<p>Hello <strong>world</strong></p>' },
  })
  assertEquals(out, 'Hello world')
})

Deno.test('[contract] liquidRuntime: strip_html 可用于 sync 渲染', () => {
  const out = renderLiquidSync('{{ item.content | strip_html }}', {
    item: { content: '<div>  <em>release</em> note </div>' },
  })
  assertEquals(out, 'release note')
})

Deno.test('[contract] liquidRuntime: to_html 直接把 markdown 转成 html', async () => {
  const out = await renderLiquid('{{ item.content | to_html }}', {
    item: { content: '# Rust' },
  })
  assertEquals(out.trim(), '<h1>Rust</h1>')
})

Deno.test('[contract] liquidRuntime: to_html 默认不自动 linkify 裸 URL', () => {
  const out = renderLiquidSync('{{ item.content | to_html }}', {
    item: { content: 'https://example.com' },
  })
  assertEquals(out.trim(), '<p>https://example.com</p>')
})

Deno.test(
  '[contract] liquidRuntime: to_markdown 直接把 html 转成 markdown 并固定 ATX 标题风格',
  () => {
    const out = renderLiquidSync('{{ item.content | to_markdown }}', {
      item: { content: '<h1>Rust</h1><p>Hello</p>' },
    })
    assertEquals(out, '# Rust\n\nHello')
  },
)

Deno.test('[contract] liquidRuntime: to_html 不再接受 format 参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_html: 'markdown' }}", {
        item: { content: '# Rust' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: to_markdown 不再接受 format 参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_markdown: 'html' }}", {
        item: { content: '<p>Rust</p>' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: to_telegram_html 默认保留 blockquote expandable 属性', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<blockquote expandable>Quote</blockquote>',
    },
  })
  assertEquals(out, '<blockquote expandable>Quote</blockquote>')
})

Deno.test(
  '[contract] liquidRuntime: to_telegram_html 对齐 Telegram 官方 HTML 子集并清理危险内容',
  () => {
    const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
      item: {
        content:
          '<strong>Bold</strong><span class="tg-spoiler">Hidden</span><blockquote expandable>Quote</blockquote><pre><code class="language-c++">const x = 1;</code></pre><tg-emoji emoji-id="5368324170671202286">👍</tg-emoji><a href="tg://resolve?domain=knock">Open</a><script>alert(1)</script>',
      },
    })
    assertEquals(
      out,
      '<strong>Bold</strong><tg-spoiler>Hidden</tg-spoiler><blockquote expandable>Quote</blockquote><pre><code class="language-c++">const x = 1;</code></pre><tg-emoji emoji-id="5368324170671202286">👍</tg-emoji><a href="tg://resolve?domain=knock">Open</a>',
    )
  },
)

Deno.test('[contract] liquidRuntime: to_telegram_html 拒绝相对链接', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<a href="/docs/releases">Releases</a>',
    },
  })
  assertEquals(out, 'Releases')
})

Deno.test('[contract] liquidRuntime: to_telegram_html 拒绝带换行内容的相对链接', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<a href="/docs/releases">Release\nnotes</a>',
    },
  })
  assertEquals(out, 'Release\nnotes')
})

Deno.test('[contract] liquidRuntime: to_telegram_html 支持 tg-emoji emoji-id', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>',
    },
  })
  assertEquals(out, '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>')
})

Deno.test(
  '[contract] liquidRuntime: to_telegram_html 支持嵌套 pre code language class 官方写法',
  () => {
    const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
      item: {
        content: '<pre><code class="language-python">print(&quot;hi&quot;)</code></pre>',
      },
    })
    assertEquals(out, '<pre><code class="language-python">print("hi")</code></pre>')
  },
)

Deno.test('[contract] liquidRuntime: to_telegram_html 不再保留旧 pre language 属性', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<pre language="python">print(&quot;hi&quot;)</pre>',
    },
  })
  assertEquals(out, '<pre>print("hi")</pre>')
})

Deno.test('[contract] liquidRuntime: to_telegram_html 不为 standalone code 保留语言类', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<code class="language-python">print(&quot;hi&quot;)</code>',
    },
  })
  assertEquals(out, '<code>print("hi")</code>')
})

Deno.test('[contract] liquidRuntime: to_telegram_markdown_v2 转义纯文本特殊字符', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_markdown_v2 }}', {
    item: {
      content: 'Hello_world!',
    },
  })
  assertEquals(out, 'Hello\\_world\\!')
})

Deno.test('[contract] liquidRuntime: to_markdown 后可链式转成 telegram markdown v2', () => {
  const out = renderLiquidSync('{{ item.content | to_markdown | to_telegram_markdown_v2 }}', {
    item: {
      content: '<strong>Bold</strong> &amp; <em>italic</em>',
    },
  })
  assertEquals(out, '*Bold* & _italic_')
})

Deno.test(
  '[contract] liquidRuntime: to_telegram_markdown_v2 按第三方库现有行为归一化合法语法',
  () => {
    const out = renderLiquidSync('{{ item.content | to_telegram_markdown_v2 }}', {
      item: {
        content: '*Bold* _italic_ ||spoiler||',
      },
    })
    assertEquals(out, '_Bold_ _italic_ \\|\\|spoiler\\|\\|')
  },
)

Deno.test('[contract] liquidRuntime: to_telegram_markdown_v2 对非法片段做最小转义', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_markdown_v2 }}', {
    item: {
      content: 'Hello [broken link',
    },
  })
  assertEquals(out, 'Hello \\[broken link')
})

Deno.test('[contract] liquidRuntime: to_telegram_html 不再接受额外参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_telegram_html: 'html' }}", {
        item: { content: '<b>Rust</b>' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: to_telegram_markdown_v2 不再接受额外参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_telegram_markdown_v2: 'markdown' }}", {
        item: { content: 'Rust' },
      }),
    Error,
  )
})

Deno.test('[contract] liquidRuntime: to_telegram_html 日志字段使用 template namespace', () => {
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
  const runtime = createLiquidRuntime({
    logger: logger.child({ module: 'content.render' }),
  })

  const out = runtime.renderSync('{{ item.content | to_telegram_html }}', {
    item: { content: '<a href="/docs/releases">Releases</a>' },
  })

  assertEquals(out, 'Releases')
  assertEquals(logs.length, 1)
  assertEquals(logs[0].severityText, 'INFO')
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
  assertEquals('operation' in (logs[0].attributes as Record<string, unknown>), false)
})

Deno.test('[contract] liquidRuntime: ai_translate 支持异步渲染并走 entry 级 runtime', async () => {
  const calls: Array<Record<string, unknown>> = []
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
      calls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: '译文' })
    },
  })
  const runtime = createLiquidRuntime({ aiRuntime })
  const entryRuntime = aiRuntime.createEntryRuntime('source-a', 'entry-a')
  const context = attachAiEntryRuntime(
    {
      item: { content: 'Hello' },
      entry: { id: 'entry-a', content: 'Hello' },
    },
    entryRuntime,
  )

  const out = await runtime.render('{{ item.content | ai_translate }}', context)

  assertEquals(out, '译文')
  assertEquals(calls.length, 1)
})

Deno.test('[contract] liquidRuntime: ai filter 命名参数支持字符串与数字字面量', async () => {
  const calls: Array<Record<string, unknown>> = []
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
              variants: {
                creative: {
                  temperature: 0.8,
                },
              },
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
        default: {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
        'openai_main/default': {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
      },
    },
    defaultLanguage: 'zh-CN',
    generateText: (input) => {
      calls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: 'ok' })
    },
  })
  const runtime = createLiquidRuntime({ aiRuntime })
  const entryRuntime = aiRuntime.createEntryRuntime('source-a', 'entry-a')
  const context = attachAiEntryRuntime(
    {
      item: { content: 'Hello' },
      entry: { id: 'entry-a', content: 'Hello' },
    },
    entryRuntime,
  )

  const translated = await runtime.render(
    "{{ item.content | ai_translate: language: 'ja' }}",
    context,
  )
  const summarized = await runtime.render(
    "{{ item.content | ai_summarize: model: 'openai_main/default', variant: 'creative', language: 'ja', length: 80 }}",
    context,
  )

  assertEquals(translated, 'ok')
  assertEquals(summarized, 'ok')
  assertEquals(calls.length, 2)
  assertEquals(String(calls[0].system).includes('ja'), true)
  assertEquals(String(calls[1].system).includes('80 字以内'), true)
})

Deno.test('[contract] liquidRuntime: ai filter 不再兼容旧位置参数', async () => {
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
        default: {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
        'openai_main/default': {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
      },
    },
    defaultLanguage: 'zh-CN',
    generateText: () => Promise.resolve({ text: 'never' }),
  })
  const runtime = createLiquidRuntime({ aiRuntime })
  const entryRuntime = aiRuntime.createEntryRuntime('source-a', 'entry-a')
  const context = attachAiEntryRuntime(
    {
      item: { content: 'Hello' },
      entry: { id: 'entry-a', content: 'Hello' },
      model_name: 'openai_main/default',
    },
    entryRuntime,
  )

  await assertRejects(
    () => runtime.render('{{ item.content | ai_translate: model_name }}', context),
    Error,
    '仅支持命名参数',
  )
})

Deno.test('[contract] liquidRuntime: ai filter 命名参数不允许变量值', async () => {
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
        default: {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
        'openai_main/default': {
          ref: 'openai_main/default',
          providerId: 'openai_main',
          modelId: 'default',
        },
      },
    },
    defaultLanguage: 'zh-CN',
    generateText: () => Promise.resolve({ text: 'never' }),
  })
  const runtime = createLiquidRuntime({ aiRuntime })
  const entryRuntime = aiRuntime.createEntryRuntime('source-a', 'entry-a')
  const context = attachAiEntryRuntime(
    {
      item: { content: 'Hello' },
      entry: { id: 'entry-a', content: 'Hello' },
      target_lang: 'ja',
    },
    entryRuntime,
  )

  await assertRejects(
    () => runtime.render('{{ item.content | ai_translate: language: target_lang }}', context),
    Error,
    '字符串字面量',
  )
})

Deno.test('[contract] liquidRuntime: ai_summarize 的 length 支持字符串数字字面量', async () => {
  const calls: Array<Record<string, unknown>> = []
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
      calls.push(input as unknown as Record<string, unknown>)
      return Promise.resolve({ text: '摘要' })
    },
  })
  const runtime = createLiquidRuntime({ aiRuntime })
  const entryRuntime = aiRuntime.createEntryRuntime('source-a', 'entry-a')
  const context = attachAiEntryRuntime(
    {
      item: { content: 'Hello' },
      entry: { id: 'entry-a', content: 'Hello' },
    },
    entryRuntime,
  )

  const out = await runtime.render("{{ item.content | ai_summarize: length: '80' }}", context)

  assertEquals(out, '摘要')
  assertEquals(String(calls[0].system).includes('80 字以内'), true)
})

Deno.test('[contract] liquidRuntime: 字符串字面量中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('{{ "literal | ai_translate: model_name" }}', {})
  assertEquals(out, 'literal | ai_translate: model_name')
})

Deno.test('[contract] liquidRuntime: 纯文本中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('plain | ai_translate: model_name text', {})
  assertEquals(out, 'plain | ai_translate: model_name text')
})

Deno.test('[contract] liquidRuntime: comment 中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('{% comment %}| ai_translate: model_name{% endcomment %}', {})
  assertEquals(out, '')
})

Deno.test('[contract] liquidRuntime: ai filter 在 sync 渲染中直接报错', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | ai_summarize: 'default' }}", {
        item: { content: 'Hello' },
      }),
    Error,
    '仅支持异步渲染',
  )
})
