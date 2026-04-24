import { assertEquals } from '@std/assert'
import { ConfigManagementError } from '../../../../src/interfaces/web/config_management_errors.ts'
import { handler } from './global.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function sameOriginHeaders(origin: string = 'http://localhost') {
  return {
    'content-type': 'application/json',
    origin,
  }
}

Deno.test('[flow] config global api: 应返回 workbench', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqliteJson: '{}',
        loggingJson: '{}',
        aiJson: '{}',
      }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          message: 'global 配置已保存',
          workbench: {
            reader: { sources: [], deliveries: [] },
            global: {
              language: 'zh-CN',
              timezone: 'Asia/Shanghai',
              timestampFormat: 'yyyy-MM-dd HH:mm:ss',
              sqliteJson: '{}',
              loggingJson: '{}',
              aiJson: '{}',
            },
            deliveries: [],
          },
        }),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.message, 'global 配置已保存')
})

Deno.test('[contract] config global api: 非法 JSON 应返回 400', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: '{',
    }),
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.code, 'config_request_invalid')
  assertEquals(payload.category, 'validation')
})

Deno.test('[contract] config global api: 业务错误应返回结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({}),
    }),
    {
      runAction: () =>
        Promise.reject(
          new ConfigManagementError(
            'sqliteJson: 配置非法',
            400,
            'config_request_invalid',
            'validation',
          ),
        ),
    },
  )

  assertEquals(response.status, 400)
  const payload = await readJson(response)
  assertEquals(payload.code, 'config_request_invalid')
  assertEquals(payload.category, 'validation')
})

Deno.test('[contract] config global api: 跨源写请求应返回 403', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ language: 'zh-CN' }),
    }),
    {
      runAction: () => Promise.reject(new Error('should not run')),
    },
  )

  assertEquals(response.status, 403)
  const payload = await readJson(response)
  assertEquals(payload.code, 'config_action_forbidden')
  assertEquals(payload.category, 'forbidden')
})

Deno.test('[contract] config global api: internal error 应返回通用文案', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({}),
    }),
    {
      runAction: () => Promise.reject(new Error('sqlite open failed at /tmp/knock.db')),
    },
  )

  assertEquals(response.status, 500)
  const payload = await readJson(response)
  assertEquals(payload.code, 'config_action_failed')
  assertEquals(payload.category, 'internal')
  assertEquals(payload.message, '配置操作失败，请查看服务端日志。')
})
