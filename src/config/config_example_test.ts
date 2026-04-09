import { assertEquals } from '@std/assert'
import { parse } from '@std/yaml'
import { validateConfig } from './validate_config.ts'

Deno.test('config.example.yml: 提交的示例应可通过当前 schema 校验', () => {
  const example = Deno.readTextFileSync(new URL('../../config.example.yml', import.meta.url))
  const parsed = parse(example) as Record<string, unknown>
  const validated = validateConfig({
    runtimeDir: '/tmp/knock',
    ...(parsed ?? {}),
  })

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
})
