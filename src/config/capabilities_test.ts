import { assertEquals } from '@std/assert'
import { CONFIG_FIELD_CAPABILITIES, getConfigFieldCapability } from './capabilities.ts'

// 风险映射: R03 R04
// 关键字段白名单测试：以下任一条件成立的输入字段必须登记到 capabilities.ts
// 1. 支持 ${ENV}
// 2. 支持 Liquid
// 3. 需要 render 后校验
// 4. 直接影响外部请求/投递边界

Deno.test('[contract] capabilities: 已声明路径应能命中对应 capability', () => {
  assertEquals(getConfigFieldCapability('deliveries.webhook.push.http.url')?.allowLiquid, false)
  assertEquals(
    getConfigFieldCapability('deliveries.webhook.push.request.payload.text')?.allowLiquid,
    true,
  )
  assertEquals(
    getConfigFieldCapability('deliveries.release_email.email.message.to')?.postRenderValidator,
    'email-address',
  )
  assertEquals(getConfigFieldCapability('sources.feed.http.url')?.allowLiquid, false)
  assertEquals(getConfigFieldCapability('sources.feed.syndication.entry.title')?.allowLiquid, true)
  assertEquals(getConfigFieldCapability('sources.digest.summary.feed.title')?.allowLiquid, true)
  assertEquals(getConfigFieldCapability('sources.digest.summary.entry.id')?.allowLiquid, true)
})

Deno.test('[contract] capabilities: 关键用户输入字段应有能力声明', () => {
  const requiredPaths = [
    'deliveries.*.file.content',
    'deliveries.*.push.http.url',
    'deliveries.*.push.request.payload.**',
    'deliveries.*.email.message.from',
    'deliveries.*.email.message.to[]',
    'sources.*.http.url',
    'sources.*.filter',
    'sources.*.syndication.entry.*',
    'sources.*.summary.feed.*',
    'sources.*.summary.entry.*',
    'ai.defaultModel',
    'ai.providers.*.apiKey',
    'ai.providers.*.baseURL',
    'ai.providers.*.headers.*',
    'ai.providers.*.models.*.model',
    'ai.providers.*.options.organization',
    'ai.providers.*.options.project',
    'ai.providers.*.options.authToken',
  ]

  assertEquals(
    requiredPaths.every((path) => CONFIG_FIELD_CAPABILITIES.some((item) => item.path === path)),
    true,
  )
})
