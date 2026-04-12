import { assertEquals, assertStringIncludes } from '@std/assert'
import { parse } from '@std/yaml'
import { validateConfig } from './validate_config.ts'

Deno.test('config.example.yml: sources.deliveries keyed map 应通过当前 schema 校验', () => {
  const example = Deno.readTextFileSync(new URL('../../config.example.yml', import.meta.url))
  const parsed = parse(example) as Record<string, unknown>
  const validated = validateConfig({
    runtimeDir: '/tmp/knock',
    ...(parsed ?? {}),
  })

  assertEquals(validated.language, 'zh-CN')
  assertEquals(validated.ai?.defaultModel, 'openai_main/default')
  assertEquals(Object.keys(validated.deliveries ?? {}).sort(), [
    'local',
    'release_email',
    'telegram_webhook',
    'telegram_webhook_md',
    'webhook',
  ])
  assertEquals(Object.keys(validated.sources ?? {}).sort(), [
    'deno',
    'website_news',
    'website_news_byparr',
    'website_news_script',
  ])

  const denoDeliveries = validated.sources.deno.deliveries

  assertEquals(Array.isArray(denoDeliveries), false)
  assertEquals(denoDeliveries === undefined, false)

  if (!denoDeliveries) {
    throw new Error('config.example.yml 缺少 sources.deno.deliveries')
  }

  assertEquals(Object.keys(denoDeliveries).sort(), [
    'local',
    'release_email',
    'telegram_webhook',
    'telegram_webhook_md',
    'webhook',
  ])
  assertEquals(denoDeliveries.local, {})
  assertEquals(denoDeliveries.telegram_webhook, {
    payload: {
      text: '<b>[{{ source.id }}] {{ title }}</b>\n\n{{ content | to_telegram_html }}\n\n{{ link }}\n',
    },
  })
  assertEquals(denoDeliveries.telegram_webhook_md, {})
  assertEquals(denoDeliveries.webhook, {})
  assertEquals(denoDeliveries.release_email, {
    message: {
      subject: '[release][{{ source.id }}] {{ entry.title }}',
    },
  })
})

Deno.test('README.md 与 CLAUDE.md: 应记录 keyed-map 契约与 merge 语义', () => {
  const readme = Deno.readTextFileSync(new URL('../../README.md', import.meta.url))
  const claudeMd = Deno.readTextFileSync(new URL('../../CLAUDE.md', import.meta.url))

  assertEquals(readme.includes('`delivery.content`'), false)
  assertStringIncludes(readme, '`file.content`')
  assertStringIncludes(readme, '`push.request.payload`')
  assertStringIncludes(readme, '`email.message`')
  assertStringIncludes(readme, '对象 deep merge')
  assertStringIncludes(readme, '数组整体替换')
  assertStringIncludes(readme, '标量直接替换')
  assertStringIncludes(readme, 'v1 不支持 null-delete')

  const overviewMarker = '完整配置模型长这样：'
  const overviewStart = readme.indexOf(overviewMarker)
  if (overviewStart === -1) {
    throw new Error('README.md 缺少完整配置模型段落')
  }

  const overviewSlice = readme.slice(overviewStart)
  const firstFenceStart = overviewSlice.indexOf('```yml')
  const firstFenceEnd = overviewSlice.indexOf('```', firstFenceStart + '```yml'.length)

  if (firstFenceStart === -1 || firstFenceEnd === -1) {
    throw new Error('README.md 缺少完整配置模型代码块')
  }

  const overviewExample = overviewSlice.slice(firstFenceStart, firstFenceEnd)
  assertStringIncludes(overviewExample, '  release_email:\n    email:')
  assertStringIncludes(overviewExample, '      release_email:')
  assertStringIncludes(overviewExample, "          parse_mode: 'HTML'")
  assertStringIncludes(overviewExample, '            <b>[{{ source.id }}] {{ title }}</b>')

  assertStringIncludes(claudeMd, '`sources.<id>.deliveries` 是 keyed map')
  assertStringIncludes(claudeMd, 'source 侧只允许按 delivery 类型覆写消息子树')
  assertEquals(claudeMd.includes('引用投递 ID 数组'), false)
  assertEquals(claudeMd.includes('允许内联 `file` / `telegram` / `push` 投递块'), false)
})
