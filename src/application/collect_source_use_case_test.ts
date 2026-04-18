import { assertEquals } from '@std/assert'
import type { RunSourceRequest } from './run_source_use_case.ts'
import { CollectSourceUseCase } from './collect_source_use_case.ts'

Deno.test('[contract] collectSourceUseCase: 应显式走 collect-only 入口', async () => {
  const calls: RunSourceRequest[] = []
  const useCase = new CollectSourceUseCase({
    runSourceUseCase: {
      collect: (input) => {
        calls.push(input)
        return Promise.resolve({
          plan: {
            runId: 'run-collect-explicit',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-17T13:00:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-17T13:00:00.000Z',
            payloadSummary: { hash: 'hash-collect-explicit' },
          },
          parsed: {
            sourceKind: input.source.kind,
            parser: input.source.kind === 'summary' ? 'summary' : 'rss',
            diagnostics: [],
            feed: {
              title: 'Feed',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          },
        })
      },
    },
  })

  const request: RunSourceRequest = {
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'preview',
    effectDomain: 'preview',
    trigger: 'manual',
  }

  const result = await useCase.execute(request)

  assertEquals(calls, [request])
  assertEquals(result.plan.runId, 'run-collect-explicit')
})
