import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { attachAiEntryRuntime, createAiRuntime } from './ai_runtime.ts'
import { createLiquidRuntime, renderLiquid, renderLiquidSync } from './liquid_runtime.ts'

Deno.test('liquidRuntime: async 渲染可用', async () => {
  const out = await renderLiquid('{{ item.title }}', {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'Rust')
})

Deno.test('liquidRuntime: sync 渲染可用', () => {
  const out = renderLiquidSync('{{ item.title }}', { item: { title: 'Rust' } })
  assertEquals(out, 'Rust')
})

Deno.test('liquidRuntime: match_exact 可用于 async 渲染', async () => {
  const out = await renderLiquid("{{ item.title | match_exact: 'Rust' }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_exact 支持反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_exact: 'Rust', true }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'false')
})

Deno.test('liquidRuntime: match_exact 不匹配时反转后返回 true', () => {
  const out = renderLiquidSync("{{ item.title | match_exact: 'Go', true }}", {
    item: { title: 'Rust' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_exact 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_exact: 'Rust', 'true' }}", {
        item: { title: 'Rust' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: match_fuzzy 默认 both', async () => {
  const out = await renderLiquid("{{ item.title | match_fuzzy: 'amp' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_fuzzy 支持 left', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_fuzzy 支持 right', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'ple', 'right' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_fuzzy 支持默认模式的反转短写', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'amp', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('liquidRuntime: match_fuzzy 支持显式 mode 与反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('liquidRuntime: match_fuzzy 不匹配时反转后返回 true', () => {
  const out = renderLiquidSync("{{ item.title | match_fuzzy: 'zzz', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_fuzzy 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'left', 'true' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: match_regex 支持 flags', async () => {
  const out = await renderLiquid("{{ item.title | match_regex: '^example$', 'i' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: match_regex 支持无 flags 的反转短写', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^Ex', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('liquidRuntime: match_regex 支持 flags 与反转匹配', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^example$', 'i', true }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'false')
})

Deno.test('liquidRuntime: match_regex 的 invert 参数必须是布尔值', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_regex: '^Ex', 'i', 'true' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: 非法 mode 会报错', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.title | match_fuzzy: 'Ex', 'middle' }}", {
        item: { title: 'Example' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: 非法 regex 会报错', async () => {
  await assertRejects(
    () =>
      renderLiquid("{{ item.title | match_regex: '[' }}", {
        item: { title: 'Rust' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: sync 路径支持 match_regex', () => {
  const out = renderLiquidSync("{{ item.title | match_regex: '^example$', 'i' }}", {
    item: { title: 'Example' },
  })
  assertEquals(out, 'true')
})

Deno.test('liquidRuntime: strip_html 可用于 async 渲染', async () => {
  const out = await renderLiquid('{{ item.content | strip_html }}', {
    item: { content: '<p>Hello <strong>world</strong></p>' },
  })
  assertEquals(out, 'Hello world')
})

Deno.test('liquidRuntime: strip_html 可用于 sync 渲染', () => {
  const out = renderLiquidSync('{{ item.content | strip_html }}', {
    item: { content: '<div>  <em>release</em> note </div>' },
  })
  assertEquals(out, 'release note')
})

Deno.test('liquidRuntime: to_html 直接把 markdown 转成 html', async () => {
  const out = await renderLiquid('{{ item.content | to_html }}', {
    item: { content: '# Rust' },
  })
  assertEquals(out.trim(), '<h1>Rust</h1>')
})

Deno.test('liquidRuntime: to_html 默认不自动 linkify 裸 URL', () => {
  const out = renderLiquidSync('{{ item.content | to_html }}', {
    item: { content: 'https://example.com' },
  })
  assertEquals(out.trim(), '<p>https://example.com</p>')
})

Deno.test('liquidRuntime: to_markdown 直接把 html 转成 markdown 并固定 ATX 标题风格', () => {
  const out = renderLiquidSync('{{ item.content | to_markdown }}', {
    item: { content: '<h1>Rust</h1><p>Hello</p>' },
  })
  assertEquals(out, '# Rust\n\nHello')
})

Deno.test('liquidRuntime: to_html 不再接受 format 参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_html: 'markdown' }}", {
        item: { content: '# Rust' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: to_markdown 不再接受 format 参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_markdown: 'html' }}", {
        item: { content: '<p>Rust</p>' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: to_telegram_html 保留 Telegram 支持标签并清理危险内容', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content:
        '<strong>Bold</strong><span class="tg-spoiler">Hidden</span><blockquote>Quote</blockquote><a href="tg://resolve?domain=knock">Open</a><script>alert(1)</script>',
    },
  })
  assertEquals(
    out,
    '<b>Bold</b><span class="tg-spoiler">Hidden</span><blockquote>Quote</blockquote><a href="tg://resolve?domain=knock">Open</a>',
  )
})

Deno.test('liquidRuntime: to_telegram_html 拒绝相对链接', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_html }}', {
    item: {
      content: '<a href="/docs/releases">Releases</a>',
    },
  })
  assertEquals(out, 'Releases')
})

Deno.test('liquidRuntime: to_telegram_markdown_v2 转义纯文本特殊字符', () => {
  const out = renderLiquidSync('{{ item.content | to_telegram_markdown_v2 }}', {
    item: {
      content: 'Hello_world!',
    },
  })
  assertEquals(out, 'Hello\\_world\\!')
})

Deno.test('liquidRuntime: to_markdown 后可链式转成 telegram markdown v2', () => {
  const out = renderLiquidSync('{{ item.content | to_markdown | to_telegram_markdown_v2 }}', {
    item: {
      content: '<strong>Bold</strong> &amp; <em>italic</em>',
    },
  })
  assertEquals(out, '*Bold* & _italic_')
})

Deno.test('liquidRuntime: to_telegram_html 不再接受额外参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_telegram_html: 'html' }}", {
        item: { content: '<b>Rust</b>' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: to_telegram_markdown_v2 不再接受额外参数', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | to_telegram_markdown_v2: 'markdown' }}", {
        item: { content: 'Rust' },
      }),
    Error,
  )
})

Deno.test('liquidRuntime: ai_translate 支持异步渲染并走 entry 级 runtime', async () => {
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

Deno.test('liquidRuntime: ai filter 参数必须是字符串字面量', async () => {
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
    '字符串字面量',
  )
})

Deno.test('liquidRuntime: 字符串字面量中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('{{ "literal | ai_translate: model_name" }}', {})
  assertEquals(out, 'literal | ai_translate: model_name')
})

Deno.test('liquidRuntime: 纯文本中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('plain | ai_translate: model_name text', {})
  assertEquals(out, 'plain | ai_translate: model_name text')
})

Deno.test('liquidRuntime: comment 中的 ai filter 文本不应误报', async () => {
  const out = await renderLiquid('{% comment %}| ai_translate: model_name{% endcomment %}', {})
  assertEquals(out, '')
})

Deno.test('liquidRuntime: ai filter 在 sync 渲染中直接报错', () => {
  assertThrows(
    () =>
      renderLiquidSync("{{ item.content | ai_summarize: 'default' }}", {
        item: { content: 'Hello' },
      }),
    Error,
    '仅支持异步渲染',
  )
})
