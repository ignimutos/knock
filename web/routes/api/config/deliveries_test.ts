import { assertEquals } from '@std/assert'
import { ConfigManagementError } from '../../../../src/interfaces/web/config_management_errors.ts'
import { handler as deleteHandler } from './deliveries_delete.ts'
import { handler } from './deliveries.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function sameOriginHeaders(origin: string = 'http://localhost') {
  return {
    'content-type': 'application/json',
    origin,
  }
}

Deno.test('[flow] config deliveries api: 应返回 workbench', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/deliveries', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        deliveryId: 'local',
        enabled: true,
        kind: 'file',
        configJson: '{"path":"outputs/releases.md","content":"{{ entry.title }}"}',
      }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          message: 'delivery local 配置已保存',
          workbench: {
            reader: { sources: [], deliveries: [] },
            global: {
              language: '',
              timezone: '',
              timestampFormat: '',
              sqliteJson: '',
              loggingJson: '',
              aiJson: '',
            },
            deliveries: [
              {
                id: 'local',
                enabled: true,
                kind: 'file',
                config: {
                  path: 'outputs/releases.md',
                  content: '{{ entry.title }}',
                },
                configJson: '{\n  "path": "outputs/releases.md"\n}',
              },
            ],
          },
        }),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.message, 'delivery local 配置已保存')
})

Deno.test('[contract] config deliveries api: 非法 JSON 应返回 400', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/deliveries', {
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

Deno.test('[contract] config deliveries api: 业务错误应返回结构化错误体', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/deliveries', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({}),
    }),
    {
      runAction: () =>
        Promise.reject(
          new ConfigManagementError(
            'delivery.configJson: 配置非法',
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

Deno.test('[flow] config deliveries delete api: 应返回 workbench', async () => {
  const response = await deleteHandler(
    new Request('http://localhost/api/config/deliveries/delete', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        deliveryId: 'local',
      }),
    }),
    {
      runAction: () =>
        Promise.resolve({
          message: 'delivery local 已删除',
          workbench: {
            reader: { sources: [], deliveries: [] },
            global: {
              language: '',
              timezone: '',
              timestampFormat: '',
              sqliteJson: '',
              loggingJson: '',
              aiJson: '',
            },
            deliveries: [],
          },
        }),
    },
  )

  assertEquals(response.status, 200)
  const payload = await readJson(response)
  assertEquals(payload.message, 'delivery local 已删除')
})

Deno.test('[contract] config deliveries delete api: 业务错误应返回结构化错误体', async () => {
  const response = await deleteHandler(
    new Request('http://localhost/api/config/deliveries/delete', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        deliveryId: 'local',
      }),
    }),
    {
      runAction: () =>
        Promise.reject(
          new ConfigManagementError(
            'delivery local 仍被 source 引用: rust',
            409,
            'config_action_conflict',
            'conflict',
          ),
        ),
    },
  )

  assertEquals(response.status, 409)
  const payload = await readJson(response)
  assertEquals(payload.code, 'config_action_conflict')
  assertEquals(payload.category, 'conflict')
})

Deno.test('[contract] config deliveries api: 跨源写请求应返回 403', async () => {
  const response = await handler(
    new Request('http://localhost/api/config/deliveries', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({
        deliveryId: 'local',
        enabled: true,
        kind: 'file',
        configJson: '{}',
      }),
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
