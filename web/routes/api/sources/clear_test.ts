import { assertEquals } from '@std/assert'
import { type SourceActionLogMeta, handler } from './clear.ts'
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

test('[flow] R15 sources clear api: 应返回删除计数并记录日志元数据', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/clear', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          message: 'source rust 历史已清空',
          deletedRuns: 2,
          deletedItems: 4,
          deletedAttempts: 4,
          overview: { sources: [], deliveries: [] },
        }),
      onLogMeta: (meta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.deletedRuns, 2)
  assertEquals(payload.deletedItems, 4)
  assertEquals(payload.deletedAttempts, 4)
  assertEquals(logs, [
    {
      sourceId: 'rust',
      action: 'clear_history',
      started: undefined,
      deletedRuns: 2,
      deletedItems: 4,
      deletedAttempts: 4,
    },
  ])
})

test('[contract] sources clear api: 跨源写请求应返回 403', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/clear', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () => Promise.reject(new Error('should not run')),
    },
  )

  assertEquals(response.status, 403)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_action_forbidden')
  assertEquals(payload.category, 'forbidden')
})
