import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { executeWebAction } from './web_action_executor.ts'

function sameOriginHeaders(origin: string = 'http://localhost') {
  return { 'content-type': 'application/json', origin }
}

test('[contract] web action executor: 跨源写请求应短路且不调用 run', async () => {
  let called = false
  const response = await executeWebAction(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ ok: true }),
    }),
    {
      requireSameOrigin: true,
      run: async () => {
        called = true
        return { ok: true }
      },
      classifyError: () => ({
        status: 500,
        code: 'boom',
        category: 'internal',
        message: 'boom',
      }),
      forbidden: {
        message: 'config 写请求必须来自同源页面',
        code: 'config_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'config 请求非法',
        code: 'config_request_invalid',
        category: 'validation',
      },
    },
  )

  assertEquals(called, false)
  assertEquals(response.status, 403)
})

test('[contract] R19 web action executor: 非法 JSON 应返回 400', async () => {
  let called = false
  const response = await executeWebAction(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: '{',
    }),
    {
      requireSameOrigin: true,
      run: async () => {
        called = true
        return { ok: true }
      },
      classifyError: () => ({
        status: 500,
        code: 'source_action_failed',
        category: 'internal',
        message: 'source 操作失败，请查看服务端日志。',
      }),
      forbidden: {
        message: 'source 写请求必须来自同源页面',
        code: 'source_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'source 请求非法',
        code: 'source_request_invalid',
        category: 'validation',
      },
    },
  )

  assertEquals(called, false)
  assertEquals(response.status, 400)
  assertEquals((await response.json()).code, 'source_request_invalid')
})

test('[contract] web action executor: internal 错误应映射为结构化错误体', async () => {
  const response = await executeWebAction(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      requireSameOrigin: true,
      run: async () => {
        throw new Error('db open failed')
      },
      classifyError: () => ({
        status: 500,
        code: 'source_action_failed',
        category: 'internal',
        message: 'source 操作失败，请查看服务端日志。',
      }),
      forbidden: {
        message: 'source 写请求必须来自同源页面',
        code: 'source_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'source 请求非法',
        code: 'source_request_invalid',
        category: 'validation',
      },
    },
  )

  assertEquals(response.status, 500)
  assertEquals((await response.json()).code, 'source_action_failed')
})
export const testMeta = [
  {
    title: '[contract] R19 web action executor: 非法 JSON 应返回 400',
    layer: 'contract',
    risks: ['R19'],
  },
] as const
