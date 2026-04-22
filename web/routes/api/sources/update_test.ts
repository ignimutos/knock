import { assertEquals } from '@std/assert'
import { SourceManagementError } from '../../../../src/interfaces/web/source_management.ts'
import { type SourceActionLogMeta, handler } from './update.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

Deno.test('[flow] sources update api: 应转发 payload 并返回 overview', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceId: 'rust',
        name: 'Rust Blog',
        enabled: true,
        schedule: '*/30 * * * *',
        filter: '',
        deliveryIds: ['telegram'],
        transport: 'http',
        parser: 'syndication',
        targetUrl: 'https://example.com/feed.xml',
        xqueryLocate: '',
        xqueryEntryId: '',
      }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          message: 'source rust 配置已保存',
          overview: { sources: [], deliveries: [] },
        }),
      onLogMeta: (meta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.message, 'source rust 配置已保存')
  assertEquals(logs, [
    {
      sourceId: 'rust',
      action: 'update_config',
      started: undefined,
      deletedRuns: undefined,
      deletedItems: undefined,
      deletedAttempts: undefined,
    },
  ])
})

Deno.test('[contract] sources update api: 非法 JSON 应返回 400', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_request_invalid')
  assertEquals(payload.category, 'validation')
})

Deno.test('[contract] sources update api: 编译期配置错误应返回 400 validation', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () =>
        Promise.reject(
          new SourceManagementError(
            'source.rust.deliveries 引用了未定义 delivery: missing_delivery',
            400,
            'source_request_invalid',
            'validation',
          ),
        ),
    },
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_request_invalid')
  assertEquals(payload.category, 'validation')
})
