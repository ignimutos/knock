import { assertEquals } from '@std/assert'
import { type SourceActionLogMeta, handler } from './run.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

Deno.test('[flow] sources run api: 应返回 started 状态并记录日志元数据', async () => {
  const logs: SourceActionLogMeta[] = []

  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

Deno.test('[contract] sources run api: 业务错误应返回结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
