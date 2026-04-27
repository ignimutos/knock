import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './overview.ts'
import { test } from '../../../../src/testing/test_api.ts'

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test('[contract] reader overview api: GET 应返回 message、overview 与 no-store 头', async () => {
  const response = await handler(new Request('http://localhost/api/reader/overview'))

  assertEquals(response.status, 200)
  assertStringIncludes(response.headers.get('content-type') ?? '', 'application/json')
  assertEquals(response.headers.get('cache-control'), 'no-store')
  const payload = await readJson(response)
  assertEquals(payload.message, 'Reader 已刷新')
  assertEquals(typeof payload.overview, 'object')
})
