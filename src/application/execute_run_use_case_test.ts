import { assertEquals } from '@std/assert'
import type { RunSourceRequest } from './run_source_use_case.ts'
import { ExecuteRunUseCase } from './execute_run_use_case.ts'

Deno.test('[contract] executeRunUseCase: 应显式走 execute 入口', async () => {
  const calls: RunSourceRequest[] = []
  const useCase = new ExecuteRunUseCase({
    runSourceUseCase: {
      execute: (input) => {
        calls.push(input)
        return Promise.resolve({
          plan: {
            runId: 'run-execute-explicit',
            source: input.source,
            profile: input.profile,
            effectDomain: input.effectDomain,
            trigger: input.trigger,
            scheduledAt: input.scheduledAt ?? '2026-04-17T13:10:00.000Z',
            bindings: input.bindings ?? [],
          },
          fetchedInput: {
            kind: input.source.kind,
            collectedAt: '2026-04-17T13:10:00.000Z',
            payloadSummary: { hash: 'hash-execute-explicit' },
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
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
  }

  const result = await useCase.execute(request)

  assertEquals(calls, [request])
  assertEquals(result.plan.runId, 'run-execute-explicit')
})
