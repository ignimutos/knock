import { assertEquals, assertRejects } from '@std/assert'
import { createLogger } from '../../core/logger.ts'
import { ByparrSourceInputGateway } from './byparr_source_input_gateway.ts'

// risk-id: R01
// layer: contract

function parseLogs(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

Deno.test(
  '[contract] byparrSourceInputGateway: 抓取成功应记录 payload-free source 日志',
  async () => {
    const logs: string[] = []
    const payload = 'SECRET_BYPARR_PAYLOAD'
    const gateway = new ByparrSourceInputGateway({
      httpClient: {
        request: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                status: 'ok',
                solution: {
                  status: 200,
                  response: payload,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          ),
        fetchText: () => Promise.resolve(payload),
      },
      resolveSourceConfig: () => ({
        id: 'rust',
        enabled: true,
        name: 'Rust',
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          cmd: 'request.get',
          url: 'https://example.com/feed.xml',
          maxTimeout: '60s',
        },
        deliveries: [],
      }),
      logger: createLogger({
        enabled: true,
        level: 'info',
        module: 'source.fetch.byparr',
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
        fetcher: 'byparr',
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

    assertEquals(scope.name, 'source.fetch.byparr')
    assertEquals(attributes['source.operation'], 'fetch_payload')
    assertEquals(attributes['source.outcome'], 'success')
    assertEquals(attributes['source.id'], 'rust')
    assertEquals(typeof attributes['source.fetch_duration_ms'], 'number')
    assertEquals(attributes['source.payload_bytes'], new TextEncoder().encode(payload).byteLength)
    assertEquals(JSON.stringify(record).includes(payload), false)
  },
)

Deno.test(
  '[contract] byparrSourceInputGateway: 抓取失败应记录失败日志且不泄漏 payload',
  async () => {
    const logs: string[] = []
    const payload = 'SECRET_BYPARR_RESPONSE_BODY'
    const gateway = new ByparrSourceInputGateway({
      httpClient: {
        request: () => Promise.resolve(new Response(payload, { status: 503 })),
        fetchText: () => Promise.resolve(payload),
      },
      resolveSourceConfig: () => ({
        id: 'rust',
        enabled: true,
        name: 'Rust',
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          cmd: 'request.get',
          url: 'https://example.com/feed.xml',
          maxTimeout: '60s',
        },
        deliveries: [],
      }),
      logger: createLogger({
        enabled: true,
        level: 'info',
        module: 'source.fetch.byparr',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => logs.push(line),
        writeWarn: (line: string) => logs.push(line),
        writeStderr: (line: string) => logs.push(line),
      }),
    })

    await assertRejects(() =>
      gateway.fetch({
        runId: 'run-2',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'byparr',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      }),
    )

    const record = parseLogs(logs)[0]
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>

    assertEquals(scope.name, 'source.fetch.byparr')
    assertEquals(attributes['source.operation'], 'fetch_payload')
    assertEquals(attributes['source.outcome'], 'failure')
    assertEquals(attributes['source.id'], 'rust')
    assertEquals(typeof attributes['exception.type'], 'string')
    assertEquals(typeof attributes['exception.message'], 'string')
    assertEquals(typeof attributes['source.fetch_duration_ms'], 'number')
    assertEquals(JSON.stringify(record).includes(payload), false)
  },
)

Deno.test(
  '[contract] byparrSourceInputGateway: 200 非法 JSON 失败日志必须使用稳定安全错误消息',
  async () => {
    const logs: string[] = []
    const secretFragment = 'SECRET_BYPARR_JSON_FRAGMENT'
    const invalidJsonBody = `{"token":"${secretFragment}"`
    const gateway = new ByparrSourceInputGateway({
      httpClient: {
        request: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.reject(new SyntaxError(`Unexpected JSON payload: ${invalidJsonBody}`)),
          } as unknown as Response),
        fetchText: () => Promise.resolve(''),
      },
      resolveSourceConfig: () => ({
        id: 'rust',
        enabled: true,
        name: 'Rust',
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          cmd: 'request.get',
          url: 'https://example.com/feed.xml',
          maxTimeout: '60s',
        },
        deliveries: [],
      }),
      logger: createLogger({
        enabled: true,
        level: 'info',
        module: 'source.fetch.byparr',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => logs.push(line),
        writeWarn: (line: string) => logs.push(line),
        writeStderr: (line: string) => logs.push(line),
      }),
    })

    await assertRejects(() =>
      gateway.fetch({
        runId: 'run-3',
        source: {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'byparr',
          parser: 'syndication',
        },
        profile: 'production',
        effectDomain: 'production',
        trigger: 'scheduled',
        scheduledAt: '2026-04-13T10:00:00.000Z',
        bindings: [],
      }),
    )

    assertEquals(logs.length, 1)
    const record = parseLogs(logs)[0]
    const scope = (record.scope ?? {}) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>

    assertEquals(scope.name, 'source.fetch.byparr')
    assertEquals(attributes['source.operation'], 'fetch_payload')
    assertEquals(attributes['source.outcome'], 'failure')
    assertEquals(attributes['source.id'], 'rust')
    assertEquals(typeof attributes['exception.type'], 'string')
    assertEquals(typeof attributes['source.fetch_duration_ms'], 'number')
    assertEquals(JSON.stringify(record).includes(secretFragment), false)
    assertEquals(attributes['exception.message'], 'byparr source fetch failed')
  },
)
