import { assertEquals } from '../../../../src/testing/assert.ts'
import { SourceManagementError } from '../../../../src/adapters/web/source_management.ts'
import { type SourceActionLogMeta, handler } from './update.ts'
import { test } from '../../../../src/testing/test_api.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function sameOriginHeaders(origin: string = 'http://localhost') {
  return {
    'content-type': 'application/json',
    origin,
  }
}

test('[flow] R15 sources update api: 应转发 payload 并返回 overview', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: sameOriginHeaders(),
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

test('[contract] sources update api: 非法 JSON 应返回 400', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: '{',
    }),
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_request_invalid')
  assertEquals(payload.category, 'validation')
})

test('[contract] sources update api: 编译期配置错误应返回 400 validation', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: sameOriginHeaders(),
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

test('[contract] sources update api: 跨源写请求应返回 403', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/update', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () => Promise.reject(new Error('should not run')),
      onLogMeta: (meta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 403)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_action_forbidden')
  assertEquals(payload.category, 'forbidden')
  assertEquals(logs[0]?.errorCode, 'source_action_forbidden')
})
export const testMeta = [
  {
    title: '[flow] R15 sources update api: 应转发 payload 并返回 overview',
    layer: 'flow',
    risks: ['R15'],
  },
] as const
