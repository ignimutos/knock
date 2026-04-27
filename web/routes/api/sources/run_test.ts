import { assertEquals } from '@std/assert'
import { type SourceActionLogMeta, handler } from './run.ts'
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

test('[flow] R15 sources run api: 应返回 started 状态并记录日志元数据', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          started: true,
          message: 'source rust 强制获取完成',
          overview: { sources: [], deliveries: [] },
        }),
      onLogMeta: (meta) => logs.push(meta),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.started, true)
  assertEquals(logs, [
    {
      sourceId: 'rust',
      action: 'run_now',
      started: true,
      deletedRuns: undefined,
      deletedItems: undefined,
      deletedAttempts: undefined,
    },
  ])
})

test('[contract] sources run api: 业务错误应返回结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () => Promise.reject(new Error('source rust 已停用，不能强制获取')),
    },
  )

  assertEquals(response.status, 500)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_action_failed')
  assertEquals(payload.category, 'internal')
})

test('[contract] sources run api: 跨源写请求应返回 403', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/run', {
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

test('[contract] sources run api: internal error 应返回通用文案', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      runAction: () => Promise.reject(new Error('db open failed: /tmp/facts.db')),
    },
  )

  assertEquals(response.status, 500)
  const payload = await readJson(response)
  assertEquals(payload.code, 'source_action_failed')
  assertEquals(payload.category, 'internal')
  assertEquals(payload.message, 'source 操作失败，请查看服务端日志。')
})
