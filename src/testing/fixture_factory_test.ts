import { assertEquals } from '@std/assert'
import { createSourceFixture } from './fixture_factory.ts'

Deno.test('fixture-factory: 默认 source fixture 可直接用于测试', () => {
  const fixture = createSourceFixture()

  assertEquals(fixture.id, 'source-default')
  assertEquals(fixture.type, 'syndication')
  assertEquals(fixture.url, 'https://example.com/feed.xml')
  assertEquals(fixture.enabled, true)
  assertEquals(fixture.deliveries, [])
})

Deno.test('fixture-factory: 支持 overrides 覆写默认字段', () => {
  const fixture = createSourceFixture({
    id: 'source-rust',
    enabled: false,
    http: {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
      },
    },
  })

  assertEquals(fixture.id, 'source-rust')
  assertEquals(fixture.enabled, false)
  assertEquals(fixture.http.method, 'POST')
  assertEquals(fixture.http.headers.Authorization, 'Bearer token')
  assertEquals(fixture.url, 'https://example.com/feed.xml')
})
