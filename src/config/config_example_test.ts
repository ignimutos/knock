import { assertEquals } from '../testing/assert.ts'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { validateConfig } from './validate_config.ts'
import { test } from '../testing/test_api.ts'

test('[contract] config.example.yml: sources.deliveries keyed map 应通过当前 schema 校验', () => {
  const example = readFileSync(new URL('../../config.example.yml', import.meta.url), 'utf8')
  const parsed = YAML.parse(example) as Record<string, unknown>
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
