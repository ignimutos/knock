import { assertEquals, assertThrows } from '@std/assert'
import { resolveSourceConfig, selectSourceInputGateway } from './runtime_source_helpers.ts'

Deno.test('[contract] sourceRuntimeHelpers: resolveSourceConfig 应返回命中的 source config', () => {
  const source = {
    id: 'rust',
    enabled: true,
    deliveries: [],
  }

  assertEquals(resolveSourceConfig({ rust: source as never }, 'rust'), source)
})

Deno.test('[contract] sourceRuntimeHelpers: resolveSourceConfig 缺失时应显式失败', () => {
  assertThrows(() => resolveSourceConfig({}, 'rust'), Error, 'source 未定义: rust')
})

Deno.test(
  '[contract] sourceRuntimeHelpers: selectSourceInputGateway 应按 source kind/fetcher 选择 gateway',
  () => {
    const createGateway = (name: string) => ({
      name,
      fetch: () =>
        Promise.resolve({
          kind: 'fetch' as const,
          collectedAt: '2026-04-17T12:00:00.000Z',
          payloadSummary: { hash: name },
        }),
    })
    const httpGateway = createGateway('http')
    const byparrGateway = createGateway('byparr')
    const summaryGateway = createGateway('summary')

    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      httpGateway,
    )
    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'byparr',
          parser: 'xquery',
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      byparrGateway,
    )
    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'summary',
          sourceId: 'digest',
          upstreamSourceIds: ['rust'],
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      summaryGateway,
    )
  },
)
