import { assertEquals, assertRejects } from '../../testing/assert.ts'
import { createLogger } from '../../core/logger.ts'
import { HttpSourceInputGateway } from './http_source_input_gateway.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R01
// layer: contract

function parseLogs(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('[contract] httpSourceInputGateway: 抓取成功应记录 payload-free source 日志', async () => {
  const logs: string[] = []
  const payload = 'SECRET_HTTP_PAYLOAD'
  const gateway = new HttpSourceInputGateway({
    httpClient: {
      request: () => Promise.resolve(new Response(payload, { status: 200 })),
      fetchText: () => Promise.resolve(payload),
    },
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: { url: 'https://example.com/feed.xml' },
      deliveries: [],
    }),
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'source.fetch.http',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  await gateway.fetch({
    runId: 'run-1',
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
    scheduledAt: '2026-04-13T10:00:00.000Z',
    bindings: [],
  })

  const record = parseLogs(logs)[0]
  const scope = (record.scope ?? {}) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>

  assertEquals(scope.name, 'source.fetch.http')
  assertEquals(attributes['source.operation'], 'fetch_payload')
  assertEquals(attributes['source.outcome'], 'success')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(typeof attributes['source.fetch_duration_ms'], 'number')
  assertEquals(attributes['source.payload_bytes'], new TextEncoder().encode(payload).byteLength)
  assertEquals(JSON.stringify(record).includes(payload), false)
})

test('[contract] httpSourceInputGateway: 抓取失败应记录失败日志且不泄漏 payload', async () => {
  const logs: string[] = []
  const payload = 'SECRET_HTTP_RESPONSE_BODY'
  const gateway = new HttpSourceInputGateway({
    httpClient: {
      request: () => Promise.resolve(new Response(payload, { status: 503 })),
      fetchText: () => Promise.resolve(payload),
    },
    resolveSourceConfig: () => ({
      id: 'rust',
      enabled: true,
      name: 'Rust',
      http: { url: 'https://example.com/feed.xml' },
      deliveries: [],
    }),
    logger: createLogger({
      enabled: true,
      level: 'info',
      module: 'source.fetch.http',
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
      writeWarn: (line: string) => logs.push(line),
      writeStderr: (line: string) => logs.push(line),
    }),
  })

  await assertRejects(
    () =>
      gateway.fetch({
        runId: 'run-2',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      }),
    Error,
    'status=503',
  )

  assertEquals(logs.length > 0, true)
  const record = parseLogs(logs)[0]
  const scope = (record.scope ?? {}) as Record<string, unknown>
  const attributes = (record.attributes ?? {}) as Record<string, unknown>

  assertEquals(scope.name, 'source.fetch.http')
  assertEquals(attributes['source.operation'], 'fetch_payload')
  assertEquals(attributes['source.outcome'], 'failure')
  assertEquals(attributes['source.id'], 'rust')
  assertEquals(typeof attributes['exception.type'], 'string')
  assertEquals(attributes['exception.message'], 'http source fetch failed')
  assertEquals(typeof attributes['source.fetch_duration_ms'], 'number')
  assertEquals(JSON.stringify(record).includes(payload), false)
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R01'],
  },
] as const
