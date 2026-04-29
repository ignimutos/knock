import { assertEquals } from '../testing/assert.ts'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { validateConfig } from './validate_config.ts'
import { test } from '../testing/test_api.ts'

test('[contract] config.example.yml: sources.deliveries keyed map 应通过当前 schema 校验', () => {
  const example = readFileSync(new URL('../../config.example.yml', import.meta.url), 'utf8')
  const parsed = parseYaml(example) as Record<string, unknown>
  const validated = validateConfig({
    runtimeDir: '/tmp/knock',
    ...parsed,
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
    'bun',
    'daily_summary',
    'website_news',
    'website_news_byparr',
    'website_news_script',
  ])

  assertEquals(validated.sources.daily_summary.schedule, '0 0 8 * * *')
  assertEquals(validated.sources.daily_summary.summary, {
    sources: ['bun'],
    feed: {
      title: '{{ sources.bun.feed.title }} Daily Summary',
      description:
        '{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}',
    },
    entry: {
      id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}',
      title: '{{ sources.bun.feed.title }} Daily Summary',
      description:
        '窗口：{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}\n条目数：{{ sources.bun.entries | size }}\n',
      content:
        '{% for item in sources.bun.entries %}\n- {{ item.title }}{% if item.link != blank %} ({{ item.link }}){% endif %}\n{% endfor %}\n',
    },
  })

  const bunDeliveries = validated.sources.bun.deliveries

  assertEquals(Array.isArray(bunDeliveries), false)
  assertEquals(bunDeliveries === undefined, false)

  if (!bunDeliveries) {
    throw new Error('config.example.yml 缺少 sources.bun.deliveries')
  }

  assertEquals(Object.keys(bunDeliveries).sort(), [
    'local',
    'release_email',
    'telegram_webhook',
    'telegram_webhook_md',
    'webhook',
  ])
  assertEquals(bunDeliveries.local, {})
  assertEquals(bunDeliveries.telegram_webhook, {
    payload: {
      text: '<b>[{{ source.id }}] {{ title }}</b>\n\n{{ content | to_telegram_html }}\n\n{{ link }}\n',
    },
  })
  assertEquals(bunDeliveries.telegram_webhook_md, {})
  assertEquals(bunDeliveries.webhook, {})
  assertEquals(bunDeliveries.release_email, {
    message: {
      subject: '[release][{{ source.id }}] {{ entry.title }}',
    },
  })
})
