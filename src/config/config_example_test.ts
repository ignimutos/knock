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
    'daily_summary',
    'deno',
    'website_news',
    'website_news_byparr',
    'website_news_script',
  ])

  assertEquals(validated.sources.daily_summary.schedule, '0 0 8 * * *')
  assertEquals(validated.sources.daily_summary.summary, {
    sources: ['deno'],
    feed: {
      title: '{{ sources.deno.feed.title }} Daily Summary',
      description:
        '{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}',
    },
    entry: {
      id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}',
      title: '{{ sources.deno.feed.title }} Daily Summary',
      description:
        '窗口：{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}\n条目数：{{ sources.deno.entries | size }}\n',
      content:
        '{% for item in sources.deno.entries %}\n- {{ item.title }}{% if item.link != blank %} ({{ item.link }}){% endif %}\n{% endfor %}\n',
    },
  })

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

Deno.test('README.md 与 config.example.yml: 应记录 summary source 契约与示例', () => {
  const readme = Deno.readTextFileSync(new URL('../../README.md', import.meta.url))
  const example = Deno.readTextFileSync(new URL('../../config.example.yml', import.meta.url))

  assertStringIncludes(example, 'daily_summary:')
  assertStringIncludes(example, 'summary source 必须配置 schedule；它不会抓外部输入')
  assertStringIncludes(example, 'sources:')
  assertStringIncludes(example, '- deno')
  assertStringIncludes(example, '{{ source.runtime.window.previousCheckpoint }}')
  assertStringIncludes(example, '{{ source.runtime.window.scheduledAt }}')
  assertStringIncludes(example, '{{ sources.deno.feed.title }} Daily Summary')
  assertStringIncludes(example, 'sources.<id>.name 来自最近保存的 feed.title；若缺失则为空串')
  assertStringIncludes(example, '{{ sources.deno.entries | size }}')

  assertStringIncludes(readme, '`summary` source 不抓外部输入')
  assertStringIncludes(readme, '`summary` source 必须配置 `schedule`')
  assertStringIncludes(readme, '窗口前界取该 summary source 自身上次成功写入的 feed/checkpoint')
  assertStringIncludes(readme, '窗口内上游 entries 按 `last_seen_at` 选取')
  assertStringIncludes(readme, '`source.runtime.window.previousCheckpoint`')
  assertStringIncludes(readme, '`source.runtime.window.scheduledAt`')
  assertStringIncludes(readme, '`sources.<id>.name`')
  assertStringIncludes(
    readme,
    '当前实现里的 `sources.<id>.name` 也来自最近保存的 `feed.title`，若缺失则为空串',
  )
  assertStringIncludes(readme, '`sources.<id>.feed`')
  assertStringIncludes(readme, '`sources.<id>.entries`')
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
